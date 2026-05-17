# syntax=docker/dockerfile:1.7
#
# Multi-stage build para apps/web-ibe (Next.js 15 standalone público).
#
# Build (desde la raiz del monorepo):
#   docker build -t pms-web-ibe:local -f apps/web-ibe/Dockerfile .
# Run:
#   docker run --rm -p 3003:3003 \
#     -e NEXT_PUBLIC_API_URL=http://api:3000 \
#     pms-web-ibe:local

# ----------------------------------------------------------------------------
# Stage 1: deps + build
# ----------------------------------------------------------------------------
FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web-ibe/package.json ./apps/web-ibe/
COPY packages/db/package.json ./packages/db/
COPY packages/eventbus/package.json ./packages/eventbus/
COPY packages/mcp-tools/package.json ./packages/mcp-tools/

RUN pnpm install --frozen-lockfile --prefer-offline

COPY apps/web-ibe ./apps/web-ibe
COPY packages ./packages

RUN pnpm --filter @pms/db generate
RUN pnpm --filter @pms/db build
RUN pnpm --filter @pms/eventbus build
RUN pnpm --filter @pms/mcp-tools build

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pms/web-ibe build

# ----------------------------------------------------------------------------
# Stage 2: runtime (standalone)
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini libc6-compat
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3003 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/apps/web-ibe/.next/standalone ./
COPY --from=build /app/apps/web-ibe/.next/static ./apps/web-ibe/.next/static
COPY --from=build /app/apps/web-ibe/public ./apps/web-ibe/public

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3003

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web-ibe/server.js"]
