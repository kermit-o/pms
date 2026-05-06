# PMS — Operational RUNBOOK

Guía operativa: cómo levantar el sistema desde cero, cómo resetearlo, dónde
buscar logs/métricas, y qué hacer cuando algo se rompe.

> Para arquitectura, alcance y roadmap → ver [`PROJECT.md`](./PROJECT.md).

---

## 1. Levantar todo de cero (máquina nueva)

Pre-requisitos: Docker + Node 20 + pnpm 9.

```bash
git clone <repo>
cd pms

# 1. Variables de entorno
cp .env.example .env

# 2. Instalar dependencias
pnpm install

# 3. Generar Prisma Client
pnpm --filter @pms/db generate

# 4. Levantar infra local (Postgres, Redis, NATS, Keycloak, Mailhog)
pnpm infra:up

# 5. Aplicar migraciones (espera ~10s a que Postgres esté ready)
pnpm --filter @pms/db migrate:deploy

# 6. Seed de datos demo (tenant + property + admin user)
pnpm --filter @pms/db seed

# 7. Bootstrap de Keycloak (espera ~20-30s a que Keycloak esté ready)
pnpm bootstrap:keycloak

# 8. Arrancar el API
pnpm --filter @pms/api dev
```

API en `http://localhost:3000`. Métricas Prometheus en `http://localhost:9464/metrics`.

## 2. Smoke test end-to-end

Verifica que la cadena `JWT firmado → tenant_id → withTenant → RLS` funciona:

```bash
# Token desde Keycloak
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/pms/protocol/openid-connect/token" \
  -d "client_id=pms-api" -d "client_secret=pms-api-dev-secret" \
  -d "username=admin@demo.local" -d "password=demo123" \
  -d "grant_type=password" | jq -r .access_token)

# /me debe devolver tenantId, roles
curl -s http://localhost:3000/me -H "Authorization: Bearer $TOKEN" | jq

# /properties debe devolver SOLO la BCN01 (RLS aislando)
curl -s http://localhost:3000/properties -H "Authorization: Bearer $TOKEN" | jq

# MCP server smoke test
pnpm mcp:test
```

## 3. Reset completo

Si algo está corrupto (Keycloak, DB, NATS), parte de cero:

```bash
# Tira y borra TODO (volúmenes Docker)
pnpm infra:reset

# Re-bootstrap
pnpm --filter @pms/db generate
pnpm --filter @pms/db migrate:deploy
pnpm --filter @pms/db seed
pnpm bootstrap:keycloak
```

## 4. Reset solo de la base de datos

```bash
pnpm --filter @pms/db migrate:reset   # drop schema + re-apply migrations
pnpm --filter @pms/db seed
```

## 5. Tests

```bash
# Unit (no requieren infra)
pnpm test

# Integration (requieren docker compose arriba)
pnpm --filter @pms/db test:integration       # 8 tests de RLS
pnpm --filter @pms/eventbus test:integration # 2 tests round-trip NATS

# E2E del API (mock de Prisma + NATS, no requiere infra)
pnpm --filter @pms/api test:e2e

# Smoke test del MCP server (requiere infra + DB con seed)
pnpm mcp:test
```

## 6. Logs

```bash
# Logs del API en dev (ya están en consola si pnpm dev está corriendo)
# Cada log incluye trace_id/span_id si OTel detectó un span activo

# Logs de infra
pnpm infra:logs                 # tail de todos los servicios
docker logs -f pms-postgres
docker logs -f pms-keycloak
docker logs -f pms-nats
```

## 7. Inspección de datos

```bash
# Postgres
docker exec -it pms-postgres psql -U pms -d pms
# Ejemplos útiles:
#   \dt                        # listar tablas
#   SELECT * FROM tenants;
#   SELECT * FROM audit_log ORDER BY changed_at DESC LIMIT 10;

# Prisma Studio (UI)
pnpm --filter @pms/db studio   # abre http://localhost:5555

# NATS — monitor HTTP
curl -s http://localhost:8222/jsz | jq
curl -s http://localhost:8222/streamz | jq

# Keycloak — admin UI
open http://localhost:8080
# admin / admin_dev_password
```

## 8. Métricas y trazas

```bash
# Prometheus metrics
curl -s http://localhost:9464/metrics

# Jaeger (opcional — habilita trazas visualizables)
docker run -d --name jaeger \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Y en .env:
echo 'OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318' >> .env
# Reinicia el API. UI: http://localhost:16686
```

## 9. Troubleshooting

### "Cannot find module 'fastify'" o similar

- Olvidaste `pnpm install` tras un pull. Ejecuta y reintenta.

### "type 'citext' does not exist" al hacer migrate:reset

- Las extensiones se crean en la migración inicial — debería estar arreglado.
  Si vuelve: `pnpm infra:reset` rehace los volúmenes desde init scripts.

### "Token missing tenant_id claim"

- El protocol mapper no está activo en Keycloak. Re-ejecuta `pnpm bootstrap:keycloak`.
- Verifica que el atributo `tenant_id` está en el usuario:
  ```bash
  ADMIN_TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
    -d "grant_type=password" -d "client_id=admin-cli" \
    -d "username=admin" -d "password=admin_dev_password" | jq -r .access_token)
  curl -s "http://localhost:8080/admin/realms/pms/users?email=admin@demo.local" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.[0].attributes'
  ```

### "permission denied for schema public" al migrate:deploy

- `DIRECT_URL` no está en `.env` o apunta al rol `pms_app` (que no es owner).
  Debe apuntar al rol `pms` (superuser): ver `.env.example`.

### `/readyz` devuelve 503

- Mira `checks` en la respuesta para ver qué subsistema falla (db / nats).
- Para DB: `docker ps | grep postgres` y `docker logs pms-postgres`.
- Para NATS: `curl http://localhost:8222/healthz`.

### Puerto 3000 ocupado tras Ctrl+C

```bash
pkill -f "ts-node-dev" 2>/dev/null
lsof -ti:3000 | xargs -r kill -9
```

### `pnpm install` se queja de lockfile incompatible

- `pnpm install --no-frozen-lockfile` para regenerarlo en local.
  Asegúrate de committearlo si es legítimo el cambio.

## 10. Tareas comunes de desarrollo

```bash
# Aplicar Prettier a todo
pnpm format

# Lint + typecheck + test antes de commit
pnpm lint && pnpm typecheck && pnpm test

# Ver el grafo de tasks de Turbo
pnpm exec turbo run build --graph

# Una nueva migración tras cambiar schema.prisma
pnpm --filter @pms/db migrate:dev --name <descripcion>
```

## 11. Flujo de trabajo Git

- Branch de desarrollo: `claude/plan-hotel-saas-rWaWw` (ver §11 PROJECT.md).
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- PRs a `main` con CI verde.
- No mergear sin que pasen format + lint + typecheck + test + build.

## 12. Cierre nocturno (Night Audit)

> Guion para el auditor nocturno (rol `night_auditor`). Ejecuta el cierre del día anterior cada noche. Toda la operación es auditada y reanudable.

### 12.1 Pre-requisitos

- Sesión iniciada en la UI (`/login` → Keycloak) con rol `night_auditor` o `tenant_admin`.
- Property ID a mano (UUID del hotel).
- Caja física contada con la fecha que vas a cerrar (no el día de hoy).

### 12.2 Flujo en la UI

1. Abre `/night-audit?propertyId=<UUID>&businessDate=<YYYY-MM-DD>`.
2. Panel "Reconciliación de cajas":
   - Lee el campo "Esperado" (suma de pagos en efectivo del día).
   - Introduce el conteo real en "Cash count" (decimales con punto).
   - Ajusta tolerancia en centavos si tu hotel acepta cuadres no exactos. Si la discrepancia supera la tolerancia, el cierre se bloquea hasta corregir.
   - Guarda. Si hay diferencia, queda registrada en el audit log y emite `cash.reconciliation_discrepancy`.
3. Pulsa "Lanzar cierre". El sistema ejecuta los 6 pasos:
   - `POST_ROOM_CHARGES`
   - `POST_TAXES`
   - `POST_PACKAGES`
   - `MARK_NO_SHOWS`
   - `SNAPSHOT_REPORTS`
   - `CLOSE_DAY`
4. Si un paso falla, la fila del run queda en `FAILED` con `lastFailedStep` y `lastError`. Corrige la causa y pulsa "Reanudar"; los pasos COMPLETED no se re-ejecutan.
5. Cuando el run sale `COMPLETED`, abre `/reports?propertyId=<UUID>&date=<YYYY-MM-DD>` para ver Manager / Revenue / Tax / In-house / Arrivals-Departures del día. Cada reporte tiene "Descargar CSV".

### 12.3 Modo CLI (curl, sin UI)

```bash
# 1. Conta caja:
curl -X POST "$API_URL/cash/reconciliations" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"propertyId":"'$PROPERTY_ID'","businessDate":"2026-06-10","countedAmount":250.00,"toleranceCents":0}'

# 2. Lanza el cierre:
curl -X POST "$API_URL/night-audit/run" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"propertyId":"'$PROPERTY_ID'","businessDate":"2026-06-10"}'

# 3. Si falla, reanuda con el runId:
curl -X POST "$API_URL/night-audit/runs/<RUN_ID>/resume" \
  -H "authorization: Bearer $TOKEN"

# 4. Estado actual del día:
curl "$API_URL/night-audit/state?propertyId=$PROPERTY_ID&businessDate=2026-06-10" \
  -H "authorization: Bearer $TOKEN"

# 5. Reportes (JSON o CSV):
curl "$API_URL/reports/manager?propertyId=$PROPERTY_ID&businessDate=2026-06-10" \
  -H "authorization: Bearer $TOKEN"
curl "$API_URL/reports/revenue?propertyId=$PROPERTY_ID&from=2026-06-01&to=2026-06-10&format=csv" \
  -H "authorization: Bearer $TOKEN" -o revenue.csv
```

### 12.4 Idempotencia y reanudación

- Una sola fila `night_audit_runs` por `(property, businessDate)`. Re-ejecutar `POST /night-audit/run` sobre un día ya `COMPLETED` retorna el resumen sin ejecutar nada.
- Cada paso usa una `idempotency_key` derivada de `(businessDate, step, scope)`:
  - `POST_ROOM_CHARGES`: `na:room:<date>:<reservationId>`
  - `POST_TAXES`: `na:tax:<date>:<reservationId>`
  - `POST_PACKAGES`: `na:pkg:<date>:<reservationId>:<pkgCode>`
- Las `folio_entries` son append-only. Una corrección posterior se postea como entry inversa, nunca con `UPDATE`.

### 12.5 Cosas que pueden ir mal

- **`Cash reconciliation missing for ...`** — falta el conteo de caja. Vuelve al panel y guárdalo.
- **`Cash discrepancy ... exceeds tolerance ...`** — la diferencia supera la tolerancia. Cuenta otra vez o sube `toleranceCents` con justificación en `notes`.
- **`Reservation in status NO_SHOW cannot be patched`** — alguien intentó tocar una reserva ya marcada por el step. Llamar a tenant_admin para reabrir el día (`POST /business-day/reopen`) si fue error humano.
- **El run queda `IN_PROGRESS` sin progresar** — probablemente un fallo en NATS o DB durante un step. `POST /night-audit/runs/:id/resume` lo retoma desde `lastFailedStep`.

### 12.6 Reabrir un día cerrado (admin)

Sólo `tenant_admin`. Queda registrado con motivo en el audit log:

```bash
curl -X POST "$API_URL/business-day/reopen" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"propertyId":"'$PROPERTY_ID'","businessDate":"2026-06-10","reason":"corrección tardía"}'
```
