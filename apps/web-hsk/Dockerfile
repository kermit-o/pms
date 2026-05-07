# syntax=docker/dockerfile:1.7
#
# Multi-stage build para apps/web-hsk (Next.js 15 PWA standalone).
#
# Build (desde la raiz del monorepo):
#   docker build -t pms-web-hsk:local -f apps/web-hsk/Dockerfile .
# Run:
#   docker run --rm -p 3002:3002 \
#     -e NEXTAUTH_URL=http://localhost:3002 \
#     -e NEXTAUTH_SECRET=... \
#     -e KEYCLOAK_ISSUER=http://localhost:8080/realms/pms \
#     -e KEYCLOAK_CLIENT_ID=pms-hsk -e KEYCLOAK_CLIENT_SECRET=... \
#     -e NEXT_PUBLIC_API_URL=http://api:3000 \
#     pms-web-hsk:local

# ----------------------------------------------------------------------------
# Stage 1: deps + build
# ----------------------------------------------------------------------------
FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web-hsk/package.json ./apps/web-hsk/
COPY packages/db/package.json ./packages/db/
COPY packages/eventbus/package.json ./packages/eventbus/
COPY packages/mcp-tools/package.json ./packages/mcp-tools/

RUN pnpm install --frozen-lockfile --prefer-offline

COPY apps/web-hsk ./apps/web-hsk
COPY packages ./packages

RUN pnpm --filter @pms/db generate
RUN pnpm --filter @pms/db build
RUN pnpm --filter @pms/eventbus build
RUN pnpm --filter @pms/mcp-tools build

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pms/web-hsk build

# ----------------------------------------------------------------------------
# Stage 2: runtime (standalone)
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini libc6-compat
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3002 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/apps/web-hsk/.next/standalone ./
COPY --from=build /app/apps/web-hsk/.next/static ./apps/web-hsk/.next/static
COPY --from=build /app/apps/web-hsk/public ./apps/web-hsk/public

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3002

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web-hsk/server.js"]
