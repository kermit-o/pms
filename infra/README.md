# Infra local

Servicios de desarrollo local levantados con Docker Compose.

## Servicios

| Servicio | Puerto | Uso |
|---|---|---|
| Postgres (PMS) | 5432 | Base de datos principal |
| Redis | 6379 | Cache + colas BullMQ |
| NATS JetStream | 4222 (cliente) / 8222 (monitor) | Event bus |
| Keycloak | 8080 | Auth (admin: localhost:8080/admin) |
| Keycloak DB | — | Postgres dedicado a Keycloak (no expuesto) |
| Mailhog | 1025 (SMTP) / 8025 (UI) | SMTP local para testing de emails |

## Comandos

```bash
pnpm infra:up      # levantar todo
pnpm infra:down    # parar
pnpm infra:logs    # logs en streaming
pnpm infra:reset   # destruir volúmenes y volver a empezar (⚠️ borra datos)
```

## Configuración inicial de Keycloak

1. Acceder a http://localhost:8080
2. Login con `admin` / `admin_dev_password` (ver `.env.example`)
3. Crear realm `pms`
4. Crear cliente `pms-api` (confidential, service accounts on)
5. Roles: `tenant_admin`, `front_desk`, `night_auditor`, `housekeeping_supervisor`, `housekeeper`

> ⏳ Pendiente: script de bootstrap automático del realm vía Keycloak Admin REST API.
