# @pms/db

Schema de Prisma, migraciones y políticas RLS.

## Responsabilidades

- `schema.prisma` — modelo de datos canónico.
- Migraciones versionadas.
- Políticas Row-Level Security (multi-tenant).
- Seed scripts para dev/test.
- Cliente Prisma extendido con inyección automática de `tenant_id`.

## Multi-tenancy

Toda tabla operativa lleva `tenant_id`. RLS aplicada con `current_setting('app.tenant_id')`. El cliente Prisma del API setea esa variable de sesión en cada conexión basándose en el JWT del request.
