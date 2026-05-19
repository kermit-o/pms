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
flyctl postgres restore <snapshot-id> --name pms-postgres-drill --region cdg

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

---

## 16. Operativa IA (Sprint 6)

Configuración y troubleshooting de las capacidades IA del PMS.

### 16.1 Copilot (Anthropic adapter) — Sprint 6 W1

**Variables de entorno (`pms-api`):**

- `ANTHROPIC_API_KEY` — clave Anthropic Console. Si no está, el copilot
  cae al stub determinista (suficiente para tests, no para producción).
- `COPILOT_DRIVER` — fuerza `anthropic` o `stub`. Default: auto según
  la presencia de la API key.
- `COPILOT_MODEL` — default `claude-sonnet-4-6`. Para latencia/coste
  bajos: `claude-haiku-4-5-20251001`.

**Desactivar el copilot temporalmente:**

```bash
flyctl secrets set -a pms-api COPILOT_DRIVER=stub
```

El UI sigue funcionando pero el LLM no se invoca. Útil si hay un
incidente con Anthropic.

**Auditoría legal y observabilidad de coste.** Cada turno se persiste
en la tabla `copilot_messages` (RLS por `tenant_id`). Para auditar
qué pidió un usuario:

```sql
SELECT created_at, role, tool_name, content_text, input_tokens, output_tokens
FROM copilot_messages
WHERE tenant_id = '<TENANT>' AND user_id = '<USER>'
ORDER BY created_at DESC LIMIT 100;
```

**Métricas Prometheus:** `copilot_messages_total`, `copilot_tokens_total`,
`copilot_latency_seconds_*`. Dashboard `aubergine-copilot`.

**Privacidad.** El contenido de `copilot_messages.content_text` puede
incluir PII (nombres de huéspedes mencionados en el prompt). La política
de retención es 90 días — un job de NA poda lo antiguo. Si un huésped
ejerce derecho de supresión GDPR, hay que borrar las filas asociadas.

### 16.2 Anomaly Detection NA — Sprint 6 W2

**Cómo funciona.** Tras `SNAPSHOT_REPORTS` el orchestrator corre el step
`DETECT_ANOMALIES` que evalúa 4 reglas V1 contra `folio_entries`,
`cash_drawer_reconciliations` y `reservations` del business day:

- `DUPLICATE_CHARGE` (critical) — mismo `idempotency_key`, distinto amount.
- `CASH_DRAWER_VARIANCE` (high) — |discrepancy| / expected > 5%.
- `DEEP_DISCOUNT` (medium) — DISCOUNT ≥ 50% del CHARGE del folio.
- `CANCELLATION_SPREE` (medium) — mismo guest > 3 cancellations.

Las señales se escriben en `night_audit_anomalies` y nunca bloquean el
cierre (ADR-020).

**Revisión.** El supervisor abre `/night-audit/anomalies` en la web FO,
filtra por property/fecha/severity, marca cada señal como "revisada" con
nota libre. Tabla en `night_audit_anomalies.reviewed_at` queda con
timestamp + `reviewed_by_user_id`.

**Alerta.** `NightAuditAnomalyDetected` dispara cuando hay señales
HIGH/CRITICAL — sale por Slack `#aubergine-incidentes`, no es page (la
revisión es asincrónica).

**Re-ejecución del step.** Si el run falla y se reanuda (`resume`), el
step borra `nightAuditAnomaly.deleteMany({ runId })` antes de detectar
de nuevo. Idempotente sin tocar señales de otros runs del mismo día.

### 16.3 Voice-first HSK — Sprint 6 W3

**Cómo se usa.** En `/task/[id]` con la tarea `IN_PROGRESS`, la camarera
ve un botón flotante (esquina inferior derecha) con icono de micrófono.
Pulsarlo arranca el reconocedor del browser:

- Cada frase final se concatena al campo "notas".
- Si la frase contiene una palabra clave de estado (`limpia`, `sucia`,
  `inspeccionada`, `averia`, `fuera de servicio`, `roto`), el formulario
  cambia automáticamente el "Estado de la habitación".

**Privacidad.** Web Speech API procesa el audio en el browser. Aubergine
no recibe el audio. La nota textual (después de la conversión) sí se
envía a la API normal y se persiste en `housekeeping_tasks.notes`.

**Browser support.** Chrome/Edge/Safari en móvil sí. Firefox no soporta
SpeechRecognition — el botón se oculta y el flujo de teclado sigue
funcionando idéntico.

**Desactivarlo.** No hay flag server-side: si el supervisor del hotel no
quiere voz, puede pedir al user agent que bloquee el permiso de
micrófono.

### 16.4 Forecasting (Holt) — Sprint 6 W4

**Modelo.** Double exponential smoothing (Holt) sin estacionalidad. Grid
search alpha/beta minimizando SSE in-sample. Bandas 95% sobre desviación
estándar de residuales escaladas por √horizonte.

**Métricas soportadas:**

| metric    | Fuente                                                  |
|-----------|--------------------------------------------------------|
| occupancy | `night_audit_snapshots[MANAGER].occupancyPct`           |
| adr       | `night_audit_snapshots[MANAGER].adr`                    |
| revpar    | `night_audit_snapshots[MANAGER].revpar`                 |
| pickup    | `reservations` con `DATE(created_at) = arrival_date`   |

**Ventana de entrenamiento:** 365 días (fallback 90 si la propiedad es
nueva). Si la serie tiene menos de 14 puntos, el servicio devuelve
`series=[]` con un mensaje pidiendo más historia.

**Endpoint:**

```
GET /night-audit/forecast?propertyId=...&horizon=30&metric=occupancy
```

Devuelve `{ series, history, modelFit: { alpha, beta }, rmse, mape, message }`.
RMSE/MAPE permiten al supervisor calibrar la confianza.

**UI.** `/dashboard/forecast` — selector de property + metric + horizonte
(7/14/30/60/90), gráfico SVG inline con bandas de confianza, tabla con
puntos pronosticados.

**MCP tool.** `forecast_demand` está expuesto al copilot (read-only,
auto-exec). Permite preguntas tipo "qué ocupación esperas el viernes" o
"calcula ADR del próximo mes".

**Calidad del modelo.** Holt sin estacionalidad infraestima estacionalidad
semanal (fin de semana). Mejora obvia para V2: añadir componente seasonal
(Holt-Winters propiamente dicho) cuando tengamos ≥90 días de historia
realista por hotel piloto.

### 16.5 Reservation copilot embebido — Sprint 6 W5

**Dónde aparece.** El drawer del copilot (`CopilotSidebar`) se monta
globalmente desde `apps/web-fo/src/app/layout.tsx` cuando hay sesión.
Disponible en `/calendar`, `/reservations/new` y cualquier otra ruta.

**Atajo.** ⌘K / Ctrl+K abre/cierra el drawer.

**Streaming.** Cada turno usa
`POST /api/copilot/sessions/:id/messages?stream=true`, que la API expone
como `text/event-stream`. El cliente parsea los frames SSE con
`apps/web-fo/src/lib/copilot-stream.ts` y muestra una traza viva:

```
Pensando…
→ list_room_types
← list_room_types ok
→ search_availability_by_type
← search_availability_by_type ok
```

Esto da feedback durante el agentic loop (potencialmente largo con
varios read-only tools encadenados). Cuando llega `event: done`, el
log se vacía y se renderiza el `SessionView` final.

**Confirmación inline.** Para tools mutating, el último mensaje
contiene un `PendingToolCard` con los args + "Aprobar" / "Rechazar".
La aprobación llama a `POST /confirm-tool` (no stream). Si el tool
aprobado es `create_reservation`, el drawer redirige al detalle.

**Limitación conocida.** Los phase events del adapter se acumulan y se
emiten al final del turno (limitación del W1 streaming generator);
visualmente parecen llegar de golpe en sesiones cortas. Cuando el loop
real dura segundos, el progreso sí se ve incrementalmente. Mejora a
**EventEmitter real** queda como follow-up.

**Token-level deltas del LLM.** Aún no expuestos. Requiere usar
`client.beta.messages.stream()` dentro de `AnthropicAdapter`; el
contrato SSE ya está listo para recibir un nuevo `event: delta`.

### 16.6 Stripe Fase 2 — cobro off-session no-show

**Cuándo aplica.** Reservas con `status=NO_SHOW`, `guaranteeStatus=SECURED`
y `stripePaymentMethodId` no nulo (capturado en Fase 1).

**Endpoint:** `POST /payments/stripe/reservations/:id/charge-no-show` con
body `{ amount: number, description?: string }`. Devuelve:

| status            | Significado                                          |
|-------------------|-----------------------------------------------------|
| `succeeded`       | PaymentIntent ok + folio entry creada                |
| `already_charged` | Idempotente — re-pulsar no duplica                   |
| `requires_action` | El banco pide SCA — operador toma in-person          |
| `failed`          | Otro error (`error` con el message de Stripe)        |

**Idempotencia.** El folio entry se posta con
`idempotencyKey = stripe-no-show-{reservationId}`. Al PaymentIntent se le
pasa `idempotencyKey = pi-stripe-no-show-{reservationId}` en el request a
Stripe. Re-llamar el endpoint devuelve `already_charged`.

**Refund.** No implementado en Fase 2. Si hay que devolver, hacerlo desde
el Stripe Dashboard manualmente y reflejar el contra-cargo en el folio con
una entrada CHARGE negativa. Refund automatizado queda para V3.

**UI.** En `/reservations/[id]` aparece una sección "Cobro de no-show"
sólo cuando se cumplen las condiciones. El operador confirma el monto
(default = total de la reserva).

**3DS / SCA.** Aunque el `SetupIntent` de Fase 1 verificó la tarjeta, el
banco puede pedir SCA en el cargo off-session (regulación PSD2). Cuando
ocurre, la API devuelve `requires_action`; la UI explica al operador que
debe retomar el cobro con el huésped presente (por ahora vía Stripe
Dashboard o un nuevo SetupIntent → Charge on-session).

**Trazabilidad.** El `PaymentIntent.id` y `latest_charge` se guardan en
`folio_entries.attributes.stripePaymentIntentId` y `.stripeChargeId`. El
audit log del folio capta la creación del entry.

### 16.7 Voice-first Front Office — Sprint 7 W1

**Dónde aparece.** En `/reservations/[id]`, cuando el folio está abierto,
sobre el bloque de "Añadir cargo / Registrar pago".

**Cómo se usa.** Pulsa el micro, dicta una frase tipo:
- "Carga 35 a la 305 por minibar" → pre-rellena el form de cargo.
- "Cobra 50 en efectivo por extras" → pre-rellena el form de pago con
  paymentMethod=CASH.

Luego revisas y pulsas el botón habitual ("Añadir cargo" / "Registrar
pago"). **Nada se ejecuta sin tu confirmación** (ADR-020).

**Gramática V1.** Parser regex puro (`apps/web-fo/src/lib/voice-fo-grammar.ts`):

| Frase de ejemplo                              | Intent          |
|----------------------------------------------|-----------------|
| `carga 35 a la 305 por limpieza`             | `add_charge`    |
| `cargo de cincuenta euros desayuno`          | `add_charge`    |
| `cobra 100 en efectivo`                      | `add_payment`   |
| `pago de treinta y cinco con tarjeta`        | `add_payment`   |

Si no detecta intent claro, muestra el transcript y deja al operador
escribir. Los números 0-99 en palabras (`treinta y cinco`) se entienden.

**Privacidad.** Idéntica al W3 HSK — audio procesado en el browser, jamás
sale del dispositivo. La descripción textual final viaja a la API como
parte del form normal.

**Walk-in vía voz.** No incluido en V1. El wizard de 3 pasos en
`/reservations/new` requiere parser más complejo (nombre, fechas, room
type). Queda como follow-up.

---

## 17. Datos sintéticos para demos y testing — Sprint 7 W4

`scripts/seed-synthetic.ts` genera uno o varios hoteles ficticios con
catálogo de habitaciones, tarifas, huéspedes y reservas históricas
realistas. Útil mientras no haya piloto operando.

### 17.1 Salvaguardas

El script aborta si detecta una conexión productiva (`fly.dev`,
`flycast`, `rds.amazonaws`, `supabase.co`, `neon.tech` en la URL, o
`NODE_ENV=production`). Para forzar (jamás recomendado): `--force-prod`.

Todo lo creado lleva `attributes.synthetic = true`, así que es
borrable selectivamente sin tocar datos reales.

### 17.2 Uso

```bash
DIRECT_URL="postgres://pms:pms@localhost:5432/pms" \
  pnpm tsx scripts/seed-synthetic.ts \
    --tenant 33333333-3333-3333-3333-333333333333 \
    --properties 3 \
    --rooms-per-property 40 \
    --history-months 24 \
    --reservations-per-month 200
```

Flags relevantes:

| Flag                        | Default                                | Notas                       |
|----------------------------|----------------------------------------|-----------------------------|
| `--tenant <uuid>`           | `333…333`                              | Crea el tenant si no existe |
| `--properties <N>`          | `1`                                    |                             |
| `--rooms-per-property <N>`  | `30`                                   |                             |
| `--history-months <N>`      | `12`                                   |                             |
| `--reservations-per-month`  | `100`                                  | Por property                |
| `--reset`                   | off                                    | Borra sintéticos antes      |
| `--seed <int>`              | `42`                                   | Reproducibilidad LCG        |
| `--no-confirm`              | off                                    | Salta el delay inicial      |

### 17.3 Qué genera

- **Tenant** `Synthetic Hotels` (idempotente por UUID).
- **Properties** con código `SYN01`, `SYN02`, … en ciudades ES.
- **Room types**: IND, DBL, TWN, SUP, JSU, SUI con shares realistas
  (45% DBL, 20% IND, etc.).
- **Habitaciones** distribuidas en plantas, status `CLEAN`.
- **Rate plan** `BAR` por property.
- **Huéspedes** con nombres ES (50 por property), mix de
  nacionalidades, ~25% con `membershipLevel ∈ {Gold, Platinum, VIP}`,
  email único `*.synthetic.test`.
- **Reservas** mes a mes con estacionalidad (jul/ago 1.5×, ene/feb
  0.55×, etc.). Status realista según fecha (CHECKED_OUT pasadas,
  CHECKED_IN actuales, PENDING/CONFIRMED futuras, ~8% CANCELLED, ~4%
  NO_SHOW).
- **Folio entries** por noche para reservas activas/pasadas, con
  payment final para CHECKED_OUT.
- **Agencia/Empresa** en una fracción (`AGENT` source → agencyName,
  10% companyName aleatorio).

### 17.4 Limpieza

```bash
pnpm tsx scripts/seed-synthetic.ts --reset --properties 0 --no-confirm \
  --tenant 33333333-3333-3333-3333-333333333333
```

Borra folio entries, reservation guests, folios, reservas y huéspedes
con `attributes.synthetic = true` del tenant indicado.

### 17.5 Reproducibilidad

Mismo `--seed` produce la misma secuencia de huéspedes y reservas (LCG
determinista). Útil para regresiones de UI.

### 18. Memoria semántica del huésped — Sprint 7 W2

`guest_memory_chunks` materializa trozos de texto del huésped (cardex,
estancias, folio notes, solicitudes especiales) y permite al copilot
responder "¿qué pidió Pérez la última vez?", "¿tiene alergias?",
"¿prefiere alguna habitación?".

**V1 sin embeddings reales (decisión scope):** retrieval con tsvector
en español + ts_rank de Postgres. La columna `vector_pending = true`
deja el camino abierto a V1.1 con `pgvector` + embeddings reales cuando
se apruebe la dep `openai` (o equivalente).

**Tool MCP** `recall_guest_history(guestId, query, limit)`. Read-only,
auto-exec. Output `{ chunks: [{ sourceKind, sourceRef, text, score }], ingested }`.

**Ingesta.** Lazy — la primera vez que `recall` ve `count = 0` para un
guestId, llama a `ingestForGuest(guestId)` que lee cardex + 10 últimas
reservas + folio entries y materializa chunks idempotentes. Re-ingesta
re-escribe (deleteMany + createMany) — no acumula obsoletos.

**Cardex extra-fields.** Si `guest.attributes.preferences` o `.allergies`
están seteados (JSON), se incluyen como líneas dedicadas en el chunk
CARDEX. Útil para que el copilot las recupere con queries directas.

**Privacidad / GDPR.** Los chunks contienen PII (nombres, alergias,
documento). RLS por `tenant_id`. Cuando un huésped ejerce supresión, el
`onDelete: CASCADE` de `guests` borra automáticamente sus chunks.

**Cuándo re-ingestar.** Hoy lazy on-demand. Para V1.1 conviene añadir
un hook en `reservations.service.checkOut` que llame
`ingestForGuest(primaryGuest)` para incorporar la estancia recién
cerrada al recall.

### 19. CV inspección HSK con Claude Vision — Sprint 7 W3

**Cuándo aplica.** Tras completar una tarea HSK, la camarera o el
supervisor abre la tarea, sube una foto del cuarto desde el panel
"Inspección visual" y el sistema decide `clean / dirty / damaged`.

**Endpoint:** `POST /housekeeping/tasks/:id/inspect` con body
`{ imageBase64: "data:image/...;base64,..." }`. Estados aceptados:
`IN_PROGRESS` o `COMPLETED` (retries idempotentes — la última inspección
sobreescribe `attributes.inspection`).

**Modelo:** `claude-sonnet-4-6` (o lo que configure `COPILOT_MODEL`)
con un único bloque `image` + prompt en español pidiendo JSON estricto
`{ verdict, issues, confidence, reasoning }`. Sin webhooks, llamada
síncrona; suele tardar 2-5 s.

**Persistencia:**
- `housekeeping_tasks.attributes.inspection = { verdict, issues,
  confidence, reasoning, model, imageUrl, hasInlinePhoto, reviewedAt,
  reviewedByUserId }`.
- Si `verdict === 'damaged'` y la tarea tiene `roomId`, la habitación
  pasa a `OUT_OF_ORDER` server-side.
- La foto se almacena vía `PhotoStorageService.storeIn('hsk-inspection',
  …)`. Driver inline (dev) o S3 (prod) según `PHOTO_STORAGE_DRIVER`.

**Privacidad / GDPR.** La foto sí cruza a Anthropic. Documentar al
hotel como subprocesador del DPA cuando se active. En dev, sin
`ANTHROPIC_API_KEY`, el endpoint responde 503 y el flujo manual
(operador marca CLEAN/DIRTY a mano) sigue intacto.

**Desactivarlo.** No hay flag dedicado server-side; basta con quitar
`ANTHROPIC_API_KEY` o configurar `COPILOT_DRIVER=stub`. El frontend
muestra el error 503 y el operador continúa con el flujo manual.

**Coste estimado.** Sonnet-4-6 con una imagen 1024×768 + prompt
corto ≈ 1500 tokens input + 200 output = ~$0.012/inspección. Para 100
inspecciones/día/hotel ≈ $36/mes.

---

## 20. Online Booking Engine (IBE) — Sprint 8 W1 API pública

### 20.1 Publicación

Cada `Property` gana `public_slug` (TEXT, unique) y `published_at`
(TIMESTAMPTZ). El IBE solo expone properties con `published_at IS NOT NULL`.

Para publicar un hotel:

```sql
UPDATE properties
SET public_slug = 'hotel-berenjena', published_at = now()
WHERE id = '<property-uuid>';
```

Para despublicar (apaga el IBE para ese property):

```sql
UPDATE properties SET published_at = NULL WHERE id = '<property-uuid>';
```

### 20.2 Endpoints

Base path: `/public/ibe`. Sin auth. Rate-limit in-memory por IP+ruta.

| Método | Ruta                                              | Rate (V1)       |
|--------|--------------------------------------------------|-----------------|
| GET    | `/properties/:slug`                              | 60/min          |
| GET    | `/properties/:slug/availability?arrival&departure&adults&children` | 30/min |
| POST   | `/properties/:slug/reservations`                 | 5/hora          |
| GET    | `/properties/:slug/reservations/:code?lastName=` | 20/min          |
| POST   | `/properties/:slug/reservations/:code/cancel`    | 5/hora          |

Body de `POST reservations` valida con Zod: arrival/departure ISO,
roomTypeId, occupancy, guest con `gdprConsent: true` obligatorio,
`marketingConsent` opcional. Crea Reservation + Folio + Guest con
`source = DIRECT` y `notes = 'Reserva creada desde IBE público'`.

### 20.3 Identidad / audit

Sin auth, el `actorId` del contexto es la constante
`00000000-0000-0000-0000-000000000000` ("huésped público IBE"). El
correlationId se genera por request (`ibe-<rand>`) para trazar.

### 20.4 Rate limit

`RateLimitGuard` propio (sin nueva dep). Buckets in-memory por
`route|ip`. Suficiente para piloto; reemplazar por `@nestjs/throttler`
+ Redis cuando haya multi-instancia real.

### 20.5 Cancelación

`computePenalty` lee `CancellationPolicy.hoursBeforeArrival` y
`penaltyPct`. Si no hay política → 0 (gratis). Si la penalización > 0
y el body no envía `acceptPenalty: true`, responde 409 con el monto;
el huésped reintenta con la confirmación. La penalización NO se cobra
automáticamente — el operador la cobra desde back-office (Stripe Fase 2
si aplica).

### 20.6 Eventos

- `reservation.created v1` con `source = DIRECT` cuando viene del IBE
  (no hay flag específico V1 — `notes` lo registra).
- `reservation.cancelled v1` con `reason = "Cancelada por el huésped
  desde IBE"` y `policyApplied = <policyName>`.

### 20.7 App pública `apps/web-ibe` — Sprint 8 W2

Next.js 15 standalone, sin auth, mobile-first. Sirve todos los hoteles
via slug en URL (`/h/<slug>`). Una sola app para N properties.

**Rutas V1:**

| Ruta | Estado |
|------|--------|
| `/` | Landing con buscador de hotel |
| `/h?slug=...` | Redirect a `/h/<slug>` |
| `/h/<slug>` | Home del hotel + formulario de búsqueda |
| `/h/<slug>/availability?arrival&departure&adults&children&lang` | Listado de tarifas |
| `/h/<slug>/book` | (W3, pendiente) |
| `/h/<slug>/manage` | (W4, pendiente) |
| `/manage` | Redirector genérico |

**i18n.** ES/EN sin librería externa — diccionario en
`apps/web-ibe/src/lib/i18n.ts`, locale por `?lang=es|en` con default
`es`. Migrar a `next-intl` cuando el catálogo crezca.

**SEO.** Schema.org `Hotel` JSON-LD inyectado en `<head>` de cada
hotel. Falta `LodgingReservation` (cuando exista la página de
confirmación en W3).

**Performance.** Build de Sprint 8 W2: First Load JS = 109 kB
(objetivo < 200 kB cumplido). Páginas server-rendered on demand
(`dynamic = 'force-dynamic'`) porque la disponibilidad varía por
fecha.

**Deploy.**

```bash
flyctl deploy -c apps/web-ibe/fly.toml --dockerfile apps/web-ibe/Dockerfile
```

DNS apuntando al app handle (`pms-web-ibe.fly.dev`). Para custom
domain `book.<hotel>.es` por property → usar SSR redirect o un
proxy CDN — diseño en Sprint 9.

### 20.8 Booking flow + Stripe — Sprint 8 W3

**Rutas web-ibe:**

| Ruta | Descripción |
|------|------------|
| `/h/<slug>/book?arrival&departure&adults&children&roomTypeId` | Form datos huésped + GDPR |
| `/h/<slug>/book/<code>?lastName=` | Confirmación + opcional captura tarjeta |
| `/api/setup-intent?slug&code&lastName` (POST) | Proxy a API pública |
| `/api/confirm-setup-intent?slug&code&lastName` (POST) | Proxy a confirm |

**Endpoints API públicos (W3):**

| Método | Ruta | Rate |
|--------|------|------|
| POST | `/public/ibe/properties/:slug/reservations/:code/setup-intent` | 10/min |
| POST | `/public/ibe/properties/:slug/reservations/:code/confirm-setup-intent` | 10/min |

Body `{ lastName }`. Devuelven `{ clientSecret, publishableKey }` y
`{ status, brand, last4 }` respectivamente.

**Flujo end-to-end:**

1. Huésped llena `/book` con sus datos + GDPR consent.
2. Server action llama `POST /public/ibe/.../reservations` (W1).
3. Redirect a `/book/<code>?lastName=...`.
4. Página de confirmación muestra resumen + botón opcional "Capturar
   tarjeta".
5. Al pulsar, se obtiene SetupIntent vía proxy → API pública →
   `StripeService.createSetupIntent` (reusa back-office) con AuthUser
   sentinel.
6. Modal con Stripe Elements (igual que web-fo). Tras
   `confirmSetup` exitoso, llama `confirm-setup-intent` proxy →
   `StripeService.confirmSetupIntent` marca reserva SECURED.
7. UI muestra "✓ Tarjeta guardada · Visa **** 4242".

**Privacidad / PCI.** El PAN nunca toca nuestros servidores (SAQ A).
El sentinel actor para audit es
`00000000-0000-0000-0000-000000000000`.

**Schema.org LodgingReservation** inyectado en la confirmación.

### 20.9 Manage my reservation — Sprint 8 W4

**Endpoint nuevo (API):**

| Método | Ruta | Rate |
|--------|------|------|
| POST | `/public/ibe/properties/:slug/reservations/:code/resend-confirmation` | 3/hora |

Body `{ lastName }`. Verifica `(code, lastName)`. V1 sólo loguea
estructurado — el consumer real de email (Postmark/SendGrid) llega en
Sprint 9. Devuelve `{ queued: true, email }`.

**Ruta web-ibe:**

| Ruta | Descripción |
|------|------------|
| `/h/<slug>/manage` | Form lookup (code + apellido). Si vienen via query, muestra detalle |

Flujo:

1. El huésped abre `/h/<slug>/manage`, introduce code + apellido.
2. Server action redirige a `?code=…&lastName=…`.
3. Vista carga `getReservation`. Muestra estado, fechas, tipo, total,
   política de cancelación.
4. Acciones:
   - **Reenviar email** — server action llama `resend-confirmation`.
   - **Cancelar** (solo si la reserva es cancelable). Mostramos checkbox
     "Acepto la penalización si aplica". Si la API responde 409
     pidiendo `acceptPenalty=true`, el banner amber lo indica y el
     huésped reintenta.
5. Banners: `cancelled` (con monto), `cancel_needs_accept`,
   `cancel_fail`, `resent`, `resend_fail`, `lookup_fail`.

Sin cobro automatizado de penalización — el back-office (Stripe Fase
2) lo ejecuta cuando aplique.

**Sprint 8 IBE V1 completo** (W1 API pública + W2 app web-ibe + W3
booking + Stripe + W4 manage). Pendiente: email real (S9), captcha en
abuse, pre-pago full, channel manager.

---

## 21. Email transaccional — Sprint 9 W1

### 21.1 Provider

`NotificationsService` selecciona el provider al arrancar:

- **Live** — si `POSTMARK_SERVER_TOKEN` y `NOTIFICATIONS_FROM` están
  configurados, envía via Postmark REST (`https://api.postmarkapp.com/email`).
  **Sin SDK npm** — fetch directo, cero deps nuevas.
- **Dry-run** — sin token, loguea estructurado y devuelve éxito
  artificial. Default en dev/test.

### 21.2 Env vars (Fly secrets)

```bash
flyctl secrets set -a pms-api \
  POSTMARK_SERVER_TOKEN=... \
  NOTIFICATIONS_FROM=reservas@aubergine.es \
  NOTIFICATIONS_REPLY_TO=hola@aubergine.es \
  IBE_PUBLIC_URL=https://book.aubergine.es \
  BACKOFFICE_PUBLIC_URL=https://app.aubergine.es
```

Postmark requiere verificar el `From` (single sender o dominio).

### 21.3 Plantillas V1

| Template                       | Trigger                          | Locales |
|--------------------------------|----------------------------------|---------|
| `reservation_confirmation`     | IBE create + resend              | ES, EN  |
| `reservation_cancelled`        | IBE cancel                       | ES, EN  |
| `front_desk_new_reservation`   | Pending S10 (front desk inbox)   | ES      |

Render: `{{ key }}` con regex puro, soporta dotted paths (`brand.name`).
Wrap HTML mínimo (table layout, inline styles, sin assets). Branding
por hotel via `params.brand.{ name, primaryColor }`.

### 21.4 Idempotencia

Postmark no garantiza dedup. El IBE invoca `sendEmail` inline tras
crear/cancelar la reserva — re-llamar al endpoint público reenvía el
mismo email (lo cual es exactamente lo deseado en `resend-confirmation`).

### 21.5 NATS

Eventos publicados (informativos, sin consumer real V1):

- `email.send_requested v1` — para productores que quieran delegar al
  consumer cuando exista (S10+).
- `reservation.confirmation_resend_requested v1` — emitido por
  `PublicIbeService.resendConfirmation`.

El consumer NATS dedicado (que mapea eventos → templates → envío
desacoplado) llegará en Sprint 10 si el piloto lo justifica. V1 hace
todo inline.

### 21.6 Branding por hotel

`Property.attributes.email.brand: { name, primaryColor, accentColor }`
si está definido lo usa el wrapper HTML. Defaults Aubergine.

### 21.7 Apagar el envío

Quitar `POSTMARK_SERVER_TOKEN` → dry-run automático. No requiere
redeploy si Fly secrets cambia (machine restart sí).

## 23. Onboarding wizard self-service — Sprint 9 W3

El wizard permite que un hotel se cree solo, sin operador Aubergine. La
provisión de **DB** es totalmente automática. La provisión de **Keycloak
realm + admin user** queda como **paso manual V1** — el wizard envía un
aviso al equipo y muestra al hotel "tus credenciales llegan en horas".
Sprint 10+ automatizamos también Keycloak.

### 23.1 Flujo

```
/onboarding                 (form email)
       │  POST /public/onboarding/start
       ▼
   Email Postmark con token "verify" (TTL 24h, HMAC firmado)
       │  click en el botón
       ▼
/onboarding/verify?token=…  (server component)
       │  POST /public/onboarding/verify
       ▼  upsert tenant (slug=pending-<hash>, onboarding_status=EMAIL_VERIFIED)
/onboarding/setup?token=…   (form hotel + admin)
       │  POST /public/onboarding/setup
       ▼  crea Property + RoomTypes default (STD x N) + Rooms 101..101+N + User INVITED
          y marca tenant onboarding_status=SETUP_DONE, slug=<derivado>.
/onboarding/done            (resumen + propiedades creadas)
```

### 23.2 Tokens

Formato compacto `base64url(payload).base64url(hmac)` con `node:crypto`
— sin lib externa. Payload:

```json
{ "kind": "verify"|"setup", "email": "x@y", "tenantId": "uuid?",
  "iat": 1747..., "exp": 1747..., "nonce": "hex8" }
```

Verificación constante en tiempo (`timingSafeEqual`). TTL 24h por
defecto (env `ONBOARDING_TOKEN_TTL_HOURS`). Sin rotación de keys V1.

### 23.3 Env vars

```bash
# Secret HMAC para firmar tokens (requerido en prod, autogen en dev).
flyctl secrets set -a pms-api ONBOARDING_SECRET="$(openssl rand -hex 32)"

# TTL del enlace de verificación (h). Default 24.
flyctl secrets set -a pms-api ONBOARDING_TOKEN_TTL_HOURS=24

# BACKOFFICE_PUBLIC_URL determina el `verifyUrl` del email.
flyctl secrets set -a pms-api BACKOFFICE_PUBLIC_URL=https://pms-web-fo.fly.dev
```

Si `ONBOARDING_SECRET` falta en producción, el módulo se niega a
arrancar (consistente con `PAIRING_SECRET`).

### 23.4 Idempotencia

- `start` con el mismo email N veces → N emails diferentes; el último
  token gana. Sin tenant creado todavía (no llenamos la DB de fantasmas).
- `verify` con el mismo token → upsert sobre slug `pending-<hash(email)>`
  → siempre mismo tenant; se puede repetir.
- `setup` con el mismo token verificado dos veces → primer call crea
  todo, segundo call recibe `400 already_done`.

### 23.5 Keycloak (paso manual V1)

Tras `setup`:

```bash
# 1. Crear realm + client + admin user en Keycloak
node scripts/keycloak-bootstrap.ts \
  --tenant-slug=<tenant-slug> \
  --admin-email=<admin-email> \
  --temporary-password="$(openssl rand -base64 12)"

# 2. Comunicar al hotel:
#    - URL del back-office: https://pms-web-fo.fly.dev
#    - Email del admin (lo que pusieron en el wizard)
#    - Password temporal (cambio forzado al primer login)
```

Cuando Sprint 10 automatice esto, `setup` llamará directamente al
Keycloak admin API y devolverá las credenciales temporales en el JSON
de respuesta.

### 23.6 Página `/onboarding/done`

Muestra al hotel:
- email del admin
- tenant ID + slug público generados
- link al IBE (`https://pms-web-ibe.fly.dev/h/<slug>`)
- link al back-office (login)
- aviso explícito de que el alta en Keycloak es **en curso (horas)**

### 23.7 Limpiar tenants fantasma

Si alguien hace `start` + `verify` y nunca completa `setup`, queda un
Tenant con `onboarding_status='EMAIL_VERIFIED'` y `slug=pending-…`. Job
de limpieza sugerido (cron nocturno, Sprint 10):

```sql
DELETE FROM tenants
WHERE onboarding_status = 'EMAIL_VERIFIED'
  AND slug LIKE 'pending-%'
  AND created_at < NOW() - INTERVAL '7 days';
```

## 25. Auto-Keycloak en onboarding — Sprint 10 W1

El wizard de onboarding (`/public/onboarding/setup`) **provisiona
automáticamente** el realm Keycloak + clients + admin user via el admin
REST API si las env vars están configuradas. Si no, hace fallback al
modo manual (V1 S9 W3) y marca el tenant
`onboarding_status='SETUP_DONE_KEYCLOAK_PENDING'`.

### 25.1 Flujo

1. `POST /public/onboarding/setup` crea Tenant + Property en una
   transacción Prisma.
2. **Después** llama a `KeycloakAdminService.provisionTenant`:
   - `obtainAdminToken()` — client_credentials contra
     `/realms/master/protocol/openid-connect/token`.
   - `createRealm(pms-<slug>)` — idempotente (404 → POST, 200 → skip).
   - `createClient('pms-api', bearerOnly=true)`.
   - `createClient('pms-fo', redirectUris=[<BACKOFFICE_PUBLIC_URL>/*])`.
   - `createUser(email, fullName)` con password temporal de 16 hex
     marcada `temporary=true` (forzosa al primer login).
3. Devuelve `{ provisioned, realm, temporaryPassword }`. Si algo
   falla, captura el error y devuelve `provisioned: false, reason`.

### 25.2 Env vars

```bash
# Service account en realm "master" con role view-realm + manage-realm + manage-users.
flyctl secrets set -a pms-api \
  KEYCLOAK_ADMIN_BASE_URL=https://kc.aubergine.me \
  KEYCLOAK_ADMIN_CLIENT_ID=admin-cli \
  KEYCLOAK_ADMIN_CLIENT_SECRET=<secret>

# Opcional. Default = BACKOFFICE_PUBLIC_URL.
flyctl secrets set -a pms-api \
  KEYCLOAK_FO_REDIRECT_URI_BASE=https://pms-web-fo.fly.dev
```

Si falta cualquiera de los tres primeros, el wizard sigue funcionando
pero el campo `provisioned` será `false` y el operador completa el
alta a mano (RUNBOOK §23.5).

### 25.3 Service account en Keycloak (paso único)

En el realm `master`:

1. Clients → Create:
   - Client ID: `admin-cli` (o el nombre que quieras)
   - Client authentication: ON
   - Authentication flow: Service accounts roles ✓
2. Service accounts roles tab → Assign:
   - `realm-management.create-realm`
   - `realm-management.manage-realm`
   - `realm-management.manage-clients`
   - `realm-management.manage-users`
3. Credentials tab → copy `Client secret` → setear en Fly.

### 25.4 Idempotencia

- Realm: lookup 200 → skip; 404 → POST.
- Clients: list por `clientId` → si encuentra, skip.
- User: list por `email exact=true` → si encuentra, reusa el id.
- Reset password: idempotente por diseño (sobrescribe).

Esto permite que un wizard re-ejecutado con el mismo email no rompa
nada — útil para piloto y recovery.

### 25.5 Apagar

```bash
flyctl secrets unset -a pms-api \
  KEYCLOAK_ADMIN_CLIENT_ID KEYCLOAK_ADMIN_CLIENT_SECRET
```

Wizard vuelve al modo manual sin redeploy (refresca al primer setup).
