# scripts/

Scripts operacionales del repo. Todos se ejecutan con `tsx` (sin compilar).

## `keycloak-bootstrap.ts`

Crea/actualiza el realm `pms` en Keycloak con los clientes, roles y users
demo necesarios. Idempotente.

```bash
pnpm bootstrap:keycloak
```

Variables de entorno relevantes:

- `KEYCLOAK_URL` (default `http://localhost:8080`)
- `KEYCLOAK_REALM` (default `pms`)
- `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`
- `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD`

## `import-piloto.ts`

**Sprint 5 W2.** Carga datos estaticos del piloto (property, room types,
rooms, rate plans) en la DB de staging/produccion. Idempotente — re-correr
el script con los mismos datos no crea duplicados.

```bash
pnpm import:piloto --dir ./piloto-data/aubergine-bcn
pnpm import:piloto --dir ./piloto-data/aubergine-bcn --dry-run
```

### Estructura del directorio de datos

```
piloto-data/<slug>/
  manifest.json          { tenantId, propertyCode, propertyName, timezone, currency }
  room-types.jsonl       una linea JSON por tipo
  rooms.jsonl            una linea JSON por habitacion
  rate-plans.jsonl       una linea JSON por tarifa
```

Hay un dataset de ejemplo en
[`./import-piloto-sample/`](./import-piloto-sample/) (8 habitaciones,
3 tipos, 3 tarifas) — ejecuta con `--dry-run` apuntando ahi para validar
el flow sin tocar la DB.

### Lo que NO hace este script

- **Guests in-house**: GDPR consent debe llegar explicito por fila.
  El piloto los crea via la UI de FO durante el check-in real.
- **Reservaciones activas**: pasan por flujos de check-in en la API real
  con sus eventos correspondientes.
- **Folios o cargos historicos**: no replicamos historia. El piloto arranca
  con su business_date inicial limpio.

### Idempotencia

Cada upsert usa la clave natural del schema:

| Entidad  | Clave                  |
| -------- | ---------------------- |
| Property | (tenant, code)         |
| RoomType | (tenant, prop, code)   |
| Room     | (tenant, prop, number) |
| RatePlan | (tenant, prop, code)   |

Las inserciones ocurren dentro de `withTenant` — RLS aplica y el audit
trigger registra cada cambio con `actor_id = 'import-piloto'`.

## `mcp-server.ts` / `mcp-smoke-test.ts`

Server MCP standalone (stdio) y smoke test contra los tools FO. Ver
RUNBOOK §2.
