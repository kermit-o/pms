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

## 13. Operativa diaria de Housekeeping (HSK)

> Guion para supervisoras y camareras. La PWA HSK (`apps/web-hsk`, puerto 3002) está separada del FO; mismo realm Keycloak `pms`, cliente distinto (`pms-hsk`).

### 13.1 Pre-requisitos

- API arriba con `PAIRING_SECRET` >= 32 caracteres en producción (en dev la API se autogenera una clave por proceso).
- Migraciones aplicadas (`pnpm --filter @pms/db migrate:deploy`). Las tablas relevantes: `housekeeping_tasks`, `lost_found_items`, `device_pairings`.
- Roles Keycloak: `housekeeping_supervisor` para supervisoras, `housekeeper` para camareras. `tenant_admin` puede hacer todo.

### 13.2 Asignación de tareas (supervisora)

UI: `/supervisor?propertyId=<UUID>&date=<YYYY-MM-DD>`. Muestra KPIs (total, en curso, completadas, duración media), agregaciones por camarera y la tabla con reasignación inline.

CLI:

```bash
# Crear (idempotente sobre property+businessDate+room+taskType):
curl -X POST "$API_URL/housekeeping/tasks" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "propertyId":"'$PROPERTY_ID'",
    "roomId":"'$ROOM_ID'",
    "businessDate":"2026-06-10",
    "taskType":"CHECKOUT_CLEAN",
    "assignedToUserId":"'$CAMARERA_ID'"
  }'

# Reasignar (también vale para des-asignar con assignedToUserId=null):
curl -X POST "$API_URL/housekeeping/tasks/$TASK_ID/reassign" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"assignedToUserId":"'$OTRA_CAMARERA_ID'"}'

# KPIs del día:
curl "$API_URL/housekeeping/tasks/summary?propertyId=$PROPERTY_ID&businessDate=2026-06-10" \
  -H "authorization: Bearer $TOKEN"
```

### 13.3 Camarera: limpiar habitación

UI: lista en `/?propertyId=<UUID>` agrupada por status. Tap en una tarea → `/task/<id>`. Botón "Empezar limpieza" (PENDING → IN_PROGRESS), formulario "Finalizar" con selector de room status (CLEAN/INSPECTED/DIRTY/OUT_OF_ORDER) y notas opcionales. Una vez COMPLETED, queda `durationMin` calculada.

Si `navigator.onLine === false`, las mutaciones se persisten en IndexedDB (`aubergine-hsk` / `mutations`) y se reintentan al volver la conexión (event `online` + intervalo de 30 s). 2xx y 409 (idempotente) drenan la entrada; el resto incrementa `attempts`. La UI muestra badge "Sin conexión" + contador de pendientes.

### 13.4 Lost & Found

UI: `/lost-found?propertyId=<UUID>`. Form con descripción, room opcional y captura de foto (`<input capture="environment">` redimensionada en canvas a 1280 px / JPEG 0.7 → payload <500 kB). Lista los recientes con su estado (FOUND / CLAIMED / DISPOSED).

CLI:

```bash
# Registrar (foto omitible):
curl -X POST "$API_URL/housekeeping/lost-found" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"propertyId":"'$PROPERTY_ID'","description":"Cargador iPhone blanco","roomId":"'$ROOM_ID'"}'

# Entregar (claim):
curl -X POST "$API_URL/housekeeping/lost-found/$ITEM_ID/claim" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"guestId":"'$GUEST_ID'","notes":"DNI verificado"}'

# Descartar tras ventana legal:
curl -X POST "$API_URL/housekeeping/lost-found/$ITEM_ID/dispose" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"reason":"90d sin reclamar"}'
```

### 13.5 Login QR (dispositivo móvil compartido)

1. Supervisora autenticada en `/supervisor/pair` introduce el `userId` de la camarera y pulsa "Generar código". Sale un código de 12 caracteres (TTL 2 min, `PAIRING_CODE_TTL_SECONDS` en env).
2. Camarera abre la PWA en el móvil compartido en `/login/qr` y teclea el código (acepta el formato `ABCD-EFGH-JKLM`). Alternativamente, si el supervisor le manda el deep-link `/login/qr?tenantId=...&code=...`, se rellena solo.
3. La API redime el código y mintea un JWT HMAC HS256 (`iss=aubergine-pairing`, TTL 12 h, `PAIRING_TOKEN_TTL_HOURS`). El front lo guarda en cookie HttpOnly `aubergine_pairing`.
4. La camarera puede operar (home, task detail, lost-found) sin pasar por Keycloak. Salir → la cookie se borra y se redirige a `/login/qr`.

CLI:

```bash
# Mint:
curl -X POST "$API_URL/housekeeping/pairings" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"targetUserId":"'$CAMARERA_ID'"}'
# → { "code": "ABCDEFGHJKLM", "expiresAt": "...", "qrPayload": "aubergine-pairing:v1?..." }

# Redeem (público, sin Bearer):
curl -X POST "$API_URL/housekeeping/pairings/redeem" \
  -H "content-type: application/json" \
  -d '{"tenantId":"'$TENANT_ID'","code":"ABCDEFGHJKLM"}'
# → { "token": "<JWT HS256>", "expiresAt": "...", "user": { ... } }
```

### 13.6 Métricas Prometheus (`:9464/metrics`)

Series emitidas por `HousekeepingMetrics`:

| Serie                             | Tipo      | Labels                                  |
| --------------------------------- | --------- | --------------------------------------- |
| `hsk_tasks_assigned_total`        | counter   | tenant, property, task_type             |
| `hsk_tasks_started_total`         | counter   | tenant, property                        |
| `hsk_tasks_completed_total`       | counter   | tenant, property, resulting_room_status |
| `hsk_tasks_cancelled_total`       | counter   | tenant, property                        |
| `hsk_task_duration_minutes_*`     | histogram | tenant, property, task_type             |
| `hsk_lost_found_registered_total` | counter   | tenant, property, has_photo             |
| `hsk_lost_found_resolved_total`   | counter   | tenant, property, status                |
| `hsk_pairings_minted_total`       | counter   | tenant                                  |
| `hsk_pairings_redeemed_total`     | counter   | tenant, outcome                         |

Alertas sugeridas (Grafana / Alertmanager):

- `rate(hsk_pairings_redeemed_total{outcome="not_found"}[5m]) > 0.5` → posible enumeration attack o usuario tecleando códigos al azar.
- `histogram_quantile(0.95, sum(rate(hsk_task_duration_minutes_bucket[1h])) by (le, property)) > 90` → tareas que se alargan más de 1.5 h en p95: revisar fotos del checklist.
- Sin `hsk_tasks_completed_total` durante el horario de turno: nadie está reportando — problema de pairing o conectividad.

### 13.7 Cosas que pueden ir mal

- **"Pairing code expired"** — el código vivió más de `PAIRING_CODE_TTL_SECONDS`. Pedir a la supervisora que mintee otro.
- **"Pairing code already redeemed"** — alguien ya canjeó ese código (mismo dispositivo refresca, o un código compartido). Mintear uno nuevo.
- **"Task in status COMPLETED cannot be cancelled"** — la state machine bloquea transiciones desde estados terminales. Si fue por error, la única vía es crear una nueva tarea (no se reabre).
- **Cola offline crece sin drenarse** — `navigator.onLine` mintió (evento de OS no disparado). Soluciones: refresh de la pestaña, o llamar manualmente al endpoint desde DevTools (`flush()` en `src/lib/offline-queue.ts`).
- **Foto rechazada con 413/422** — la imagen excede ~5 MB base64 tras el resize. Subir `JPEG_QUALITY` o bajar `TARGET_MAX_DIM` en `lost-found-form.tsx`.

### 13.8 UAT

Antes de cada release, ejecutar la checklist de `docs/SPRINT-4-UAT.md` contra staging. Cubre los 9 escenarios principales (crear/start/complete, cancel, idempotencia, lost-found con/sin foto, pairing happy path + 4 fallos, reasignación, métricas).

## 14. Incident response

> Guion del on-call. Cada alerta de `infra/grafana/alerts.yaml` (Sprint 5 W3) tiene aquí su playbook. El canal principal es `#aubergine-oncall` en Slack; las `severity=page` escalan a PagerDuty.

### 14.1 Roles + canales

| Rol                      | Quién                                     | Cuándo                                                                               |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| **On-call primario**     | rotación semanal del equipo de ingeniería | 24/7 durante el piloto. PagerDuty rota automático los lunes 09:00 CET.               |
| **On-call secundario**   | otro miembro del equipo                   | si el primario no acusa la página en 10 min.                                         |
| **Soporte hotel piloto** | account manager                           | sólo si el incidente tiene impacto visible para el operador (FO o HSK no funcionan). |

Canales:

- `#aubergine-oncall` — Slack, todas las alertas Alertmanager.
- `#aubergine-incidentes` — Slack, post-mortems + comunicación con el hotel.
- PagerDuty `aubergine-prod` service — sólo `severity=page`.

### 14.2 Severidades + SLA

| Severity        | Disparadores                                                                                                              | SLA acuse | SLA mitigación      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------- |
| **page** (P1)   | `ApiErrorRateHigh`, `NightAuditRunFailed`, `HskPairingsNotFoundBurst`                                                     | < 5 min   | < 30 min            |
| **ticket** (P2) | `ApiP95LatencyHigh`, `SesSubmissionFailing`, `HskTaskDurationP95High`, `HskNoCompletedDuringShift`, `NatsConsumerBacklog` | < 30 min  | mismo día laborable |

El **SLA del piloto** es 99.5% de disponibilidad mensual (descontando ventana de Night Audit 04:00–05:00 CET). 4h/mes de downtime aceptables — documentado en el contrato del piloto.

### 14.3 DR drill mensual

Una vez al mes (primer martes), el on-call primario ejecuta un drill de restore:

```bash
# 1. Identificar el snapshot mas reciente de pms-postgres.
flyctl postgres snapshots list pms-postgres -a pms-postgres

# 2. Provisional un cluster paralelo desde el snapshot.
flyctl postgres restore <snapshot-id> --name pms-postgres-drill --region mad

# 3. Apuntar una API "shadow" (pms-api-drill) al cluster restaurado.
flyctl secrets set -a pms-api-drill DATABASE_URL="<conn-del-cluster-restored>"
flyctl deploy -c apps/api/fly.toml --app pms-api-drill --build-context .

# 4. Smoke test: cuenta de reservas, folios, business_day_states del dia
#    anterior coinciden con prod.
curl "https://pms-api-drill.fly.dev/health/ready"
curl "https://pms-api-drill.fly.dev/reports/manager?propertyId=$PROP&businessDate=$YESTERDAY" \
  -H "authorization: Bearer $TOKEN" | jq '.totals'
# Comparar con el mismo endpoint contra prod.

# 5. Tear down.
flyctl apps destroy pms-api-drill --yes
flyctl postgres destroy pms-postgres-drill --yes
```

El drill se documenta en `docs/dr-drills/<YYYY-MM-DD>.md` con: snapshot id, tiempo de restore, diff de counts vs prod, problemas encontrados.

### 14.4 Playbooks por alerta

#### `ApiErrorRateHigh` (P1, page)

**Síntoma:** 5xx > 1% durante 5 min.

1. Mira el panel "Status code mix" en `Aubergine — API health`. ¿Qué status predomina (500, 502, 503)?
2. `flyctl logs -a pms-api | head -200` — busca el primer stack trace.
3. Casos comunes:
   - **DB caída** → `flyctl postgres status -a pms-postgres`. Si está down, restart machine. Mira `flyctl postgres logs -a pms-postgres` por OOM.
   - **NATS caído** → `flyctl logs -a pms-nats`. El publish con timeout 5s sigue trabajando si NATS responde tarde; si no responde, los `await events.publish(...)` cuelgan. Mitigación inmediata: `flyctl machine restart -a pms-nats`.
   - **Migración pending** → si justo se ha desplegado y el `release_command = prisma migrate deploy` ha fallado, el rollout abortó. `flyctl status -a pms-api` muestra la versión activa; verifica `flyctl releases -a pms-api`.
4. Si nada ágil resuelve, **rollback**: `flyctl deploy --image registry.fly.io/pms-api:<sha-anterior> -a pms-api`.
5. Post-mortem en `#aubergine-incidentes` con timeline y root cause.

#### `ApiP95LatencyHigh` (P2)

**Síntoma:** p95 > 800 ms durante 10 min (SLO objetivo 400 ms).

1. Panel "Top 10 rutas más lentas" del dashboard `api-health`. ¿Cuál ruta?
2. Si es `/reports/*` → check `flyctl postgres metrics -a pms-postgres` por queries lentas. Probable solución: añadir índice si la query plan lo justifica. PR aparte.
3. Si es `/copilot/*` → posible LLM lento. Check si `ANTHROPIC_API_KEY` está set y la tarifa Anthropic; el stub determinístico no causa latencia.
4. Si es genérico → check Fly Machine CPU + memory en `flyctl status`. Escalar `[[vm]]` si cpu sustained > 80%.

#### `NightAuditRunFailed` (P1, page)

Sigue [§12.5](#125-cosas-que-pueden-ir-mal). El on-call:

1. `curl /night-audit/state?propertyId=X&businessDate=Y` para ver el `lastFailedStep` y `lastError`.
2. Aplicar el fix correspondiente (caja recontada, NO_SHOW manual, etc.).
3. `POST /night-audit/runs/:id/resume`.
4. **No avanzar** la business_date hasta que el run quede `COMPLETED` — un día abierto bloquea todas las operaciones del día siguiente.

#### `SesSubmissionFailing` (P2)

**Síntoma:** SES.HOSPEDAJES rate de fallo > 1/h durante 1h.

1. `curl /compliance/ses/status` → mira la queue + último error.
2. Si el endpoint Guardia Civil rechaza con 4xx → revisar payload con un huésped de prueba (DNI/NIE válido).
3. Si rechaza con 5xx sostenido → el ministerio tiene incidencia. Documenta el ticket en su portal y deja la queue acumular. **No reintentar agresivo**: la regla de plazo legal son 24h desde el check-in.
4. Si la API de Aubergine rechaza local → verifica `SES_HOSPEDAJES_API_KEY` en `flyctl secrets list -a pms-api`.

#### `HskPairingsNotFoundBurst` (P1, page)

**Síntoma:** > 0.5/s de redeem con `outcome=not_found` durante 5 min — posible enumeration del código de 12 chars.

1. `flyctl logs -a pms-api | grep redeemed_token` — saca las IPs de origen de los intentos fallidos.
2. Si todas las IPs vienen del mismo /24 → posible scanner. Bloquear en Cloudflare.
3. Si el patrón es disperso → puede ser una camarera que tira el código mal varias veces. Confirma con la supervisora antes de bloquear.
4. Mitigación dura: bajar `PAIRING_CODE_TTL_SECONDS` temporalmente a 60.
5. Si la enumeration pinta seria, considerar añadir rate-limit por IP en `apps/api` — PR de seguimiento.

#### `HskTaskDurationP95High` (P2)

**Síntoma:** p95 duración tareas > 90 min en una propiedad durante 30 min.

1. Panel HSK → identificar la camarera o el `task_type` con la cola más larga.
2. Coordinar con la supervisora del piloto vía Slack o teléfono. Posibles causas: una camarera nueva, una habitación con incidencia no reportada, un checklist nuevo que la formación no cubrió.
3. **No es un incidente técnico**, pero la métrica nos avisa de un problema operacional en el hotel — alertarlo es parte del valor.

#### `HskNoCompletedDuringShift` (P2)

**Síntoma:** cero tareas completadas en 2h durante turno operativo (08:00–18:00).

1. ¿La PWA `/login/qr` carga? `curl https://hsk.aubergine.es/api/health` — si 5xx, alerta de la API ya disparó.
2. ¿Hay tareas asignadas? `GET /housekeeping/tasks?propertyId=X&from=Y&to=Y&status=PENDING`.
3. Si hay tareas pero cero `completed`, llamar al hotel — probable problema de pairing o conectividad WiFi en planta. Soluciones: re-pairing (`/supervisor/pair`), intentar 4G en lugar de WiFi.

#### `NatsConsumerBacklog` (P2)

**Síntoma:** consumer NATS > 10k pendientes durante 15 min.

1. `nats consumer ls pms-events` → cuál consumer está atascado.
2. `nats consumer info pms-events <name>` → ¿está sin asignar (no hay client)? ¿Está procesando (last delivered)?
3. Si el consumer es de un proceso muerto, `nats consumer rm pms-events <name>` para que se recree limpio cuando arranque el cliente.
4. Si el cliente está vivo y procesando lento → escalar el worker o tunnear `max_ack_pending` del consumer.

### 14.5 Comunicación con el hotel piloto

Si el incidente afecta operativa visible (FO sin login, NA sin cierre, HSK sin pairing):

1. **0–5 min**: el on-call ack en Slack `#aubergine-incidentes`. Account manager pone un mensaje al WhatsApp del hotel: _"Tenemos una incidencia, estamos en ello, te aviso en 30 min con estimación."_
2. **30 min**: nuevo mensaje con root cause + ETA o (si no hay ETA) propuesta de workaround temporal (ej. modo manual de reservas en una hoja, login Keycloak en lugar de QR).
3. **Resolución**: confirmar con el hotel que ven el sistema funcionando + post-mortem público en el canal del cliente con el patch desplegado.

### 14.6 Rotación de secrets

Cuando un incidente expone un secret (logs leakeados, breach, ex-empleado):

```bash
# PAIRING_SECRET (HMAC pairing tokens HSK)
flyctl secrets set -a pms-api PAIRING_SECRET="$(openssl rand -hex 32)"
# Las cookies actuales caducan en cuanto la API rota. Las camareras deben
# volver a hacer login QR. Para evitar el corte completo, soporta dual-secret
# durante 12h (PR de seguimiento si se vuelve operativo).

# KEYCLOAK_CLIENT_SECRET (cualquier cliente)
# 1. Rotar en la UI Admin de Keycloak (Clients → pms-X → Credentials → Regenerate).
# 2. Propagar el nuevo secret al app correspondiente:
flyctl secrets set -a pms-web-fo  KEYCLOAK_CLIENT_SECRET="<new>"
flyctl secrets set -a pms-web-hsk KEYCLOAK_CLIENT_SECRET="<new>"

# DATABASE_URL (rotar password Postgres)
flyctl postgres update pms-postgres --password-rotate
flyctl secrets set -a pms-api DATABASE_URL="<new-url>"

# SES_HOSPEDAJES_API_KEY
# Pedir nueva al MIR/operador SOS. Setear y verificar con un envio de prueba.
```

Cada rotación se documenta en `docs/dr-drills/<YYYY-MM-DD>-rotation.md` con la causa.

---

## 15. Onboarding de un nuevo hotel

> Pasos secuenciales para llevar un nuevo cliente desde "firma del contrato" a "facturando con Aubergine en producción". Estimación: 5–10 días laborables.

### 15.1 Pre-requisitos

- Contrato firmado, datos legales del hotel (CIF, dirección, IBAN).
- Acceso al sistema actual del hotel (Mews / Excel / lo que sea) para extraer:
  - Habitaciones + room types + tarifas (BAR, REF, NRF…).
  - Reservas in-house y de los próximos 7 días.
  - Cardex de huéspedes con check-out reciente (90 días) — solo si tienen GDPR consent explícito; si no, vacío.
- Credenciales SES.HOSPEDAJES de producción (operador SOS).
- Lista de roles/usuarios del hotel: `tenant_admin`, `front_desk`, `housekeeping_supervisor`, `housekeeper`, `night_auditor`.

### 15.2 Día 1 — Provisioning del tenant

```bash
# 1. Crear el tenant en Postgres (a través del seed o directamente).
psql "$DATABASE_URL" -c "INSERT INTO tenants (id, name, status) \
  VALUES ('<uuid>', 'Hotel Aubergine BCN', 'ACTIVE');"

# 2. Bootstrap de Keycloak — crear users con tenant_id mapper.
TENANT_ID=<uuid> pnpm bootstrap:keycloak
# Para cada usuario del hotel: setear tenant_id en sus atributos.

# 3. Validar que el tenant aparece y RLS aísla:
curl "$API_URL/me" -H "authorization: Bearer $HOTEL_TOKEN" | jq '.tenantId'
# Debe coincidir con el uuid de arriba.
```

### 15.3 Día 2 — Importación de datos estáticos

Ver `scripts/README.md` (`import-piloto.ts`).

```bash
# Estructura del directorio de datos:
mkdir -p piloto-data/aubergine-bcn
# manifest.json + room-types.jsonl + rooms.jsonl + rate-plans.jsonl
# (ver scripts/import-piloto-sample/ como template)

pnpm import:piloto --dir ./piloto-data/aubergine-bcn --dry-run
# Revisar el resumen.
pnpm import:piloto --dir ./piloto-data/aubergine-bcn
# Exit 0 = todo idempotente; exit 1 = filas saltadas (corregir y re-correr).
```

Verificación: `GET /properties` y `GET /rooms?propertyId=X` devuelven lo que el hotel espera.

### 15.4 Día 3 — Reservas + check-ins en paralelo

**No** importamos reservas históricas (ver `scripts/README.md`). El hotel:

1. Mantiene su sistema actual hasta el cierre del día anterior al go-live.
2. En el día del go-live (D), para cada reserva in-house, el front desk hace **check-in manual** en Aubergine (`/reservations/new` o copiloto: _"crea reserva walk-in para Juan Pérez del 2026-06-10 al 2026-06-12 en propertyId X habitación Y"_).
3. Las reservas para D+1, D+2, D+7 se crean también manuales ese mismo día.

Mientras tanto, el sistema viejo se mantiene en read-only por 30 días (compliance, auditoría) — no recibe nuevas reservas.

### 15.5 Día 4 — SES.HOSPEDAJES live

```bash
# Prueba con sandbox primero.
flyctl secrets set -a pms-api \
  SES_HOSPEDAJES_ENDPOINT="<sandbox-url>" \
  SES_HOSPEDAJES_API_KEY="<sandbox-key>"

# Smoke con un huésped de prueba (real CIF/NIF, no inventado).
curl -X POST "$API_URL/compliance/ses/submit" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"reservationId":"<test-res>"}'
# Verificar acuse en sandbox.

# Si OK, swap a producción:
flyctl secrets set -a pms-api \
  SES_HOSPEDAJES_ENDPOINT="<prod-url>" \
  SES_HOSPEDAJES_API_KEY="<prod-key>"

# Activar el job recurrente que consume la cola.
```

El primer envío real se hace asistido por el on-call: confirma visualmente el acuse de Guardia Civil + `flyctl logs -a pms-api | grep ses_submission`.

### 15.6 Día 5 — Formación del personal

Material en `docs/training/` (PDFs + vídeos cortos por rol):

| Rol                     | Material                                          | Duración |
| ----------------------- | ------------------------------------------------- | -------- |
| Front desk              | `front-desk.pdf` + `check-in.mp4` (4 min)         | 30 min   |
| Night auditor           | `night-audit.pdf` + `cierre-nocturno.mp4` (8 min) | 60 min   |
| Housekeeping supervisor | `supervisor-hsk.pdf` + `pairing.mp4` (5 min)      | 45 min   |
| Housekeeper             | `camarera-hsk.pdf` + `tarea-rapida.mp4` (3 min)   | 30 min   |
| Tenant admin            | `admin.pdf` (cuentas + Keycloak)                  | 60 min   |

Sesión presencial al menos un día completo. El on-call está en un canal Slack/WhatsApp dedicado al hotel durante las **2 primeras semanas** post-go-live para responder dudas.

### 15.7 Día 6 — Go-live

1. **04:00 CET**: el sistema viejo deja de aceptar nuevas reservas.
2. **05:00 CET**: el on-call hace un smoke completo en producción (FO check-in dummy, HSK pairing dummy, NA dry-run del día anterior con cuenta de cajas a 0).
3. **08:00 CET**: el front desk arranca el turno con Aubergine. Account manager presente físicamente o por videollamada.
4. **18:00 CET**: revisión del día con el director del hotel — KPIs (reservas creadas, checkins, lost-found, durations HSK).
5. **04:00 CET D+1**: primer Night Audit real. El night_auditor ejecuta el cierre, el on-call observa en `flyctl logs`. Si falla, sigue [§12](#12-cierre-nocturno-night-audit) + [§14.4](#playbooks-por-alerta).

### 15.8 Día 7–14 — Modo asistido

- Daily standup de 15 min con el director: qué fue bien, qué fricción.
- Bugs visibles → tickets en `#aubergine-incidentes` + PR de fix prioritario.
- Métricas Grafana revisadas cada mañana — los SLOs (p95 < 0.4s, NA close > 99%) deben cumplirse.

### 15.9 Día 14+ — Modo normal

- On-call vía PagerDuty + Slack 24/7.
- Reuniones semanales con el director del hotel para feedback.
- Backups WAL automáticos cada 6h validados con DR drill mensual ([§14.3](#143-dr-drill-mensual)).

### 15.10 Coste mensual estimado

Por hotel (ver ADR-023):

- Fly Apps + Postgres + NATS + Keycloak: ~85 €/mes
- Servicios SaaS (Upstash Redis, Backblaze B2, Grafana Cloud free tier): ~5 €/mes
- Total infra: **~90 €/mes**

Coste por hotel baja con cada nuevo cliente (la API + Keycloak + NATS son compartidos). Modelo multi-tenant (ADR-001): un solo stack sirve a todos.

### 15.11 Lo que NO entra en el onboarding del piloto

- Channel Manager (Booking.com, Expedia) — V2 según §4.4.
- Revenue Management (Duetto, IDeaS) — V2.
- POS de F&B — V2.
- Booking engine propio — V2.
- Federation con AD/LDAP del hotel — V2 si el cliente lo pide.
- App nativa iOS/Android — la PWA es la app oficial.
