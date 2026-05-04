# @pms/db

Schema de Prisma, migraciones, politicas RLS, triggers de audit y cliente tenant-scoped.

## Estructura

```
packages/db/
├── prisma/
│   ├── schema.prisma                       # Modelo de datos canonico
│   ├── migrations/
│   │   ├── migration_lock.toml
│   │   └── 20260504000000_init/
│   │       └── migration.sql               # Tablas + RLS + audit triggers + GRANTs
│   └── seed.ts                             # Tenant demo + admin user + property
└── src/
    ├── index.ts                            # Re-exporta @prisma/client + helpers
    └── tenant-context.ts                   # withTenant() — RLS + audit en transaccion
```

## Roles Postgres

- **`pms`** (owner) — superuser, ejecuta migraciones, owner de tablas. BYPASSRLS.
- **`pms_app`** — el rol que usa el API en runtime. RLS aplica sobre el.

`DATABASE_URL` apunta a `pms_app`. `DIRECT_URL` apunta a `pms`. Prisma usa
`directUrl` para migraciones, introspeccion y studio. El cliente runtime usa
`url` (pms_app).

## Comandos

```bash
# Generar Prisma Client (necesario tras clonar o cambiar schema)
pnpm --filter @pms/db generate

# Aplicar migraciones (asegurate de que docker compose este arriba)
pnpm --filter @pms/db migrate:deploy

# En desarrollo, crear nueva migracion tras cambiar el schema
pnpm --filter @pms/db migrate:dev --name <nombre>

# Resetear DB y aplicar todas las migraciones desde cero
pnpm --filter @pms/db migrate:reset

# Cargar datos de prueba (tenant demo, admin user, property BCN01)
pnpm --filter @pms/db seed

# Inspector visual
pnpm --filter @pms/db studio
```

Quick start desde cero tras `pnpm install`:

```bash
pnpm infra:up
pnpm --filter @pms/db generate
pnpm --filter @pms/db migrate:deploy
pnpm --filter @pms/db seed
```

## Multi-tenancy con RLS

Cada tabla operativa lleva `tenant_id`. Las policies RLS comparan
`tenant_id = app_current_tenant_id()` donde `app_current_tenant_id()` lee
`current_setting('app.tenant_id')`. El API setea ese valor por transaccion
con `set_config(..., true)` (LOCAL).

| Tabla       | RLS    | FORCE | Notas                                                           |
|-------------|--------|-------|-----------------------------------------------------------------|
| `tenants`   | NO     | —     | Tabla admin-level, no tiene tenant_id. Exposicion controlada por API. |
| `users`     | YES    | YES   | Aislamiento total por tenant.                                   |
| `properties`| YES    | YES   | Aislamiento total por tenant.                                   |
| `audit_log` | YES    | NO    | SELECT por tenant; INSERT solo via trigger SECURITY DEFINER.    |

## Audit log

Triggers `AFTER INSERT/UPDATE/DELETE` en `users` y `properties` insertan
en `audit_log` el snapshot pre/post cambio mas `actor_id` y
`correlation_id` leidos del session settings.

Inmutable a nivel DB:
- Sin policies para INSERT/UPDATE/DELETE → app role no puede mutar.
- La funcion trigger es `SECURITY DEFINER` (corre como owner) → bypassea RLS para insertar.

## Uso desde la API

```typescript
import { withTenant } from '@pms/db';

await prisma.withTenant(
  { tenantId: ctx.tenantId, actorId: ctx.userId, correlationId: req.id },
  async (tx) => {
    return tx.property.findMany();
  },
);
```

## Pendiente
- ADR explicito de cuando usar `withTenant` vs llamar directo (sistema).
- Test de integracion verificando aislamiento entre tenants y append-only de audit.
- Migracion futura para introducir UUID v7 en tablas de hot-path (reservas, folio).
