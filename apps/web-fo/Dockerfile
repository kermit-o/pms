# syntax=docker/dockerfile:1.7
#
# Multi-stage build para apps/web-fo (Next.js 15 standalone).
#
# Imagen producida: node:20-alpine con el bundle standalone de Next + assets.
#
# Build (desde la raiz del monorepo):
#   docker build -t pms-web-fo:local -f apps/web-fo/Dockerfile .
# Run:
#   docker run --rm -p 3001:3001 \
#     -e NEXTAUTH_URL=http://localhost:3001 \
#     -e NEXTAUTH_SECRET=... \
#     -e KEYCLOAK_ISSUER=http://localhost:8080/realms/pms \
#     -e KEYCLOAK_CLIENT_ID=pms-web -e KEYCLOAK_CLIENT_SECRET=... \
#     -e NEXT_PUBLIC_API_URL=http://api:3000 \
#     pms-web-fo:local

# ----------------------------------------------------------------------------
# Stage 1: deps + build
# ----------------------------------------------------------------------------
FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Manifest first para cachear pnpm install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web-fo/package.json ./apps/web-fo/
COPY packages/db/package.json ./packages/db/
COPY packages/eventbus/package.json ./packages/eventbus/
COPY packages/mcp-tools/package.json ./packages/mcp-tools/

RUN pnpm install --frozen-lockfile --prefer-offline

# Copia el resto + compila packages workspace antes del build de Next
# (web-fo importa @pms/db, @pms/eventbus para tipos del API client).
COPY apps/web-fo ./apps/web-fo
COPY packages ./packages

RUN pnpm --filter @pms/db generate
RUN pnpm --filter @pms/db build
RUN pnpm --filter @pms/eventbus build
RUN pnpm --filter @pms/mcp-tools build

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pms/web-fo build

# ----------------------------------------------------------------------------
# Stage 2: runtime (standalone)
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini libc6-compat
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# next standalone con outputFileTracingRoot=monorepo root produce:
#   .next/standalone/apps/web-fo/server.js  (entry)
#   .next/standalone/node_modules/...       (deps minimas)
#   .next/standalone/apps/web-fo/.next/...
# Necesitamos copiar el arbol entero para que los symlinks pnpm resuelvan.
COPY --from=build /app/apps/web-fo/.next/standalone ./
COPY --from=build /app/apps/web-fo/.next/static ./apps/web-fo/.next/static
COPY --from=build /app/apps/web-fo/public ./apps/web-fo/public

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web-fo/server.js"]
