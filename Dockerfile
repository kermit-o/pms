# syntax=docker/dockerfile:1.7
#
# Multi-stage build para apps/api del monorepo.
#
# Imagen producida: nodo `node:20-alpine` con el monorepo instalado y la app
# de NestJS compilada. Al arrancar:
#   1. Aplica migraciones Prisma pendientes (idempotente).
#   2. Lanza node dist/main.js.
#
# Build: docker build -t pms-api:local .
# Run:   docker run --rm -p 3000:3000 -p 9464:9464 \
#          -e DATABASE_URL=... -e DIRECT_URL=... -e NATS_URL=... \
#          -e KEYCLOAK_URL=... -e KEYCLOAK_REALM=... -e KEYCLOAK_CLIENT_ID=... \
#          -e REDIS_URL=... \
#          pms-api:local
#

# ----------------------------------------------------------------------------
# Stage 1: deps + build
# ----------------------------------------------------------------------------
FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copia manifest files primero para cachear `pnpm install` cuando solo cambia
# el codigo fuente.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/eventbus/package.json ./packages/eventbus/
COPY packages/mcp-tools/package.json ./packages/mcp-tools/

RUN pnpm install --frozen-lockfile --prefer-offline

# Copia el resto del codigo y compila.
COPY apps/api ./apps/api
COPY packages ./packages

RUN pnpm --filter @pms/db generate
RUN pnpm --filter @pms/api build

# ----------------------------------------------------------------------------
# Stage 2: runtime
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache tini openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production \
    APP_HOST=0.0.0.0 \
    APP_PORT=3000

# Copia el workspace COMPLETO desde build. pnpm con workspaces usa una red
# de symlinks (apps/api/node_modules -> ../../node_modules/.pnpm/...) para
# resolver las imports a nivel de cada paquete. Si copiamos solo apps/api/dist
# + node_modules raiz, Node no encuentra @opentelemetry/* o @pms/db al
# resolver desde el contexto de apps/api/dist/.
#
# Trade-off: imagen runtime ~700MB en lugar de ~300MB. Aceptable en staging.
# Para produccion futura: `pnpm deploy` con bundle pruneado.
COPY --from=build /app /app

# Usuario no-root
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000 9464

# tini como PID 1 -> manejo correcto de SIGTERM (importante para drain de NATS).
ENTRYPOINT ["/sbin/tini", "--"]

# Migraciones idempotentes + start.
# Llamamos a Prisma directamente (no via 'pnpm migrate:deploy') porque ese
# script local usa dotenv-cli que requiere un .env en disco. En el contenedor
# las env vars vienen inyectadas por la plataforma (Railway/Fly) en
# process.env y Prisma las lee directo.
# Si migrate falla la app no arranca y la plataforma reintenta.
CMD ["sh", "-c", "pnpm --filter @pms/db exec prisma migrate deploy && node apps/api/dist/main.js"]
