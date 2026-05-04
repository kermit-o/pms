# @pms/api

NestJS backend. Expone REST + MCP tools. Multi-tenant con Postgres RLS.

> **Pendiente de scaffolding (Sprint 1).** Cuando se inicialice:
>
> ```bash
> pnpm dlx @nestjs/cli new api --strict --package-manager pnpm
> ```
>
> Y se ajustará para integrarse en el monorepo (workspace deps, tsconfig extends, etc.).

## Responsabilidades

- API REST (FO, NA, HSK, admin).
- MCP server exponiendo cada acción del PMS como tool.
- Publicación de eventos a NATS JetStream.
- Auth/RBAC delegada a Keycloak (JWT validation).
- Acceso a DB vía Prisma con `tenant_id` forzado por RLS.
