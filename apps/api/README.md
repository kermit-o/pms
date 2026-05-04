# @pms/api

NestJS backend. Expone REST + MCP tools. Multi-tenant con Postgres RLS.

## Estructura

```
src/
├── main.ts                    # Bootstrap (Fastify + Pino + ValidationPipe)
├── app.module.ts              # Root module
├── config/
│   ├── env.schema.ts          # Zod schema de variables de entorno
│   └── config.module.ts       # Wraps @nestjs/config con validación Zod
├── common/
│   └── logger/                # nestjs-pino + correlation-id
└── health/
    └── health.controller.ts   # GET /healthz, /readyz
test/
└── health.e2e-spec.ts         # Test e2e con Fastify inject
```

## Scripts

```bash
pnpm dev          # nest start --watch
pnpm build        # compile a dist/
pnpm start        # node dist/main.js
pnpm test         # vitest unit tests
pnpm test:e2e     # vitest e2e tests
pnpm lint
pnpm typecheck
```

## Variables de entorno

Validadas con Zod en `src/config/env.schema.ts`. Si falta alguna o es inválida, el proceso falla en bootstrap con mensaje claro. Ver `.env.example` en la raíz del repo.

## Logging

`nestjs-pino` con:
- `correlation_id` por request (header `x-correlation-id`, generado si no llega).
- Pretty print en dev, JSON en prod.
- Redact automático de `authorization`, `cookie`, `x-api-key`, `set-cookie`.

## Pendiente (Sprint 1)

- Integración con `packages/db` (Prisma + RLS).
- Middleware de auth (JWT de Keycloak → `tenant_id` + roles).
- Guard RBAC.
- Publisher de eventos a NATS.
- MCP server montado como subapp.
- OpenTelemetry.
