# Sprint 3 — MVP Night Audit (Aubergine)

> **Versión:** 1.0 — 2026-05-06
> **Branch de desarrollo:** `claude/sprint-3-night-audit`
> **Documento padre:** [`PROJECT.md`](../PROJECT.md) §4.2 + ADR-021.
> **Predecesor:** Sprint 2 mergeado a `main` (PR #6) — FO completo + business-day locking primitives ya disponibles.

---

## 0. Norte estratégico

Sprint 3 cierra el **segundo módulo crítico del MVP** (Night Audit) según `PROJECT.md` §4.2. Sale del sprint un sistema con:

- Cierre diario operacional automatizable y reanudable.
- Reportes que un director de hotel firma como veraces.
- Compliance fiscal: locking inmutable del día.
- Reportes generativos IA: el director puede preguntar al copiloto "qué pasó ayer" y leer un análisis causal.

**Definition of Done:**

1. Auditor nocturno lanza `POST /night-audit/run` para una fecha y el sistema postea room charges + taxes + packages, marca no-shows, calcula los 5 reportes, los persiste como snapshot inmutable y cierra el día (`business_day_states.status = CLOSED`).
2. La operación es **idempotente**: re-ejecutarla sobre el mismo día no duplica cargos ni snapshots; si falla a mitad, se puede reanudar.
3. Los 5 reportes (Manager / In-house / Arrivals-Departures / Revenue / Tax) se renderizan en `/reports`, con descarga PDF/CSV.
4. Reconciliación de cajas: el cierre exige un cash count que se compara con la suma de `PAYMENT` con `paymentMethod=CASH` del día.
5. Copiloto: `generate_report` produce un resumen narrativo del día auditado.
6. CI verde, e2e cubre el happy path "crear reserva → check-in → cargo → cerrar día → ver reporte".
7. RUNBOOK §13 nuevo con guion para el auditor nocturno.

**Lo que explícitamente NO se entrega** (no son recortes, son fases siguientes):

- HSK PWA (Sprint 4)
- Forecasting / anomaly detection en streaming (post-MVP IA V1)
- Auto-reconciliación bancaria
- Reportes BI multi-mes (RevPAR, pickup, ADR trends)

---

## 1. Arquitectura del sprint

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web-fo                                                         │
│   - /night-audit         (estado actual + lanzar cierre)             │
│   - /night-audit/[date]  (resumen del día cerrado)                   │
│   - /reports             (selector de día + 5 reportes)              │
│   - /reports/[type]/[date]  (detalle individual + export)            │
│   - copiloto extendido con generate_report                            │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
┌──────────────────────────────────────────────────────────────────────┐
│  apps/api                                                            │
│   - night-audit/        (orchestrator: run, status, resume, list)    │
│      ├─ steps/post-charges.ts                                        │
│      ├─ steps/post-taxes.ts                                          │
│      ├─ steps/post-packages.ts                                       │
│      ├─ steps/mark-no-shows.ts                                       │
│      ├─ steps/snapshot-reports.ts                                    │
│      └─ steps/close-day.ts                                           │
│   - reports/            (5 generators + ad-hoc reads)                │
│   - cash/               (drawer reconciliation)                      │
│   - copilot/ → tool nuevo: generate_report                            │
└─────────┬───────────────────────────────────────┬────────────────────┘
          │ Prisma (RLS)                          │ NATS pub
          ▼                                       ▼
   PostgreSQL 16                          NATS JetStream
   - night_audit_runs                     pms.events.na.*
   - night_audit_snapshots
   - cash_drawer_reconciliations
```

**Principios heredados sin excepción:**

- Append-only en `folio_entries` (las entries del cierre son posts nuevos, no UPDATE).
- Idempotencia: cada paso del cierre derivable por `(businessDate, step, scope)`.
- Multi-tenant: todo via `withTenant`.
- Audit log: triggers ya en su sitio para las nuevas tablas.
- Event-driven: cada paso emite evento.

---

## 2. Dominios y entregables backend

### 2.1 `night-audit` — orchestrator del cierre

**Endpoints:**

- `POST /night-audit/run` — `{ propertyId, businessDate }`. Inicia (o reanuda) el cierre. Retorna el `runId` y el estado.
- `GET /night-audit/runs/:id` — detalle (status + steps completados + errores).
- `GET /night-audit/runs?propertyId&from&to` — historial.
- `POST /night-audit/runs/:id/resume` — reanudar tras fallo. Re-ejecuta desde `lastFailedStep`.
- `GET /night-audit/state?propertyId&businessDate` — devuelve si el día está OPEN/IN_PROGRESS/CLOSED + último snapshot.

**Tabla nueva: `night_audit_runs`**

- `id`, `tenant_id`, `property_id`, `business_date`, `status` (PENDING/IN_PROGRESS/COMPLETED/FAILED), `started_at`, `completed_at`, `last_failed_step`, `last_error`, `started_by_user_id`, `completed_by_user_id`, `attributes` JSONB.
- Unique `(property_id, business_date)`.

**Steps (cada uno idempotente):**

| Step                | Acción                                                                                        | Idempotencia                                              |
| ------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `post_room_charges` | Inserta `CHARGE` en cada folio activo (in-house) por la rate del día                          | `idempotencyKey = na:room:<businessDate>:<reservationId>` |
| `post_taxes`        | Inserta `TAX` con la tasa aplicable (rate plan / país)                                        | `na:tax:<businessDate>:<reservationId>`                   |
| `post_packages`     | Posts de packages (desayuno, parking, etc. del rate plan `attributes.packages`)               | `na:pkg:<businessDate>:<reservationId>:<pkgCode>`         |
| `mark_no_shows`     | `PENDING`/`CONFIRMED` con `arrivalDate <= businessDate` → `NO_SHOW` + penalty fee si política | `na:noshow:<reservationId>`                               |
| `snapshot_reports`  | Genera y persiste los 5 reportes en `night_audit_snapshots`                                   | `(propertyId, businessDate)` único                        |
| `close_day`         | Setea `business_day_states.status = CLOSED` (ya existe) + `closed_by_user_id`                 | check de status previo                                    |

**Eventos publicados:**

- `night_audit.run_started` v1
- `night_audit.step_completed` v1 (`{ runId, step, durationMs }`)
- `night_audit.step_failed` v1 (`{ runId, step, error }`)
- `night_audit.run_completed` v1 (`{ runId, businessDate, totals }`)
- (`business_day.closed` v1 ya existe — lo emite el step `close_day`)

### 2.2 `reports` — 5 reportes core

Cada generator es una función pura `(prisma, propertyId, businessDate, ctx) → ReportPayload` que usa `withTenant`. Salidas tipadas con Zod. Persistidas en `night_audit_snapshots` durante el cierre; consultables ad-hoc en cualquier momento (recomputadas on-demand fuera del snapshot).

| Reporte             | Contenido                                                                                               | Endpoint                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Manager Report      | Ocupación %, ADR, RevPAR, ingresos por categoría, in-house, llegadas/salidas previstas, % cancelaciones | `GET /reports/manager?propertyId&businessDate`     |
| In-house            | Lista de reservas activas con room, huésped principal, balance                                          | `GET /reports/in-house?propertyId&businessDate`    |
| Arrivals/Departures | Llegadas y salidas previstas para una fecha                                                             | `GET /reports/arrivals-departures?propertyId&date` |
| Revenue             | Desglose de cargos por concepto, día y mes-a-fecha                                                      | `GET /reports/revenue?propertyId&from&to`          |
| Tax                 | Desglose de IVA recaudado, por tipo y huésped                                                           | `GET /reports/tax?propertyId&from&to`              |

**Export:** los endpoints aceptan `?format=json|csv|pdf` (PDF detrás de feature flag — depende de queue de render; CSV y JSON desde día 1).

**Tabla nueva: `night_audit_snapshots`**

- `id`, `tenant_id`, `property_id`, `business_date`, `report_type` (`MANAGER/IN_HOUSE/ARRIVALS_DEPARTURES/REVENUE/TAX`), `payload` JSONB, `generated_at`.
- Unique `(property_id, business_date, report_type)`.

### 2.3 `cash` — reconciliación de cajas

**Endpoints:**

- `POST /cash/reconciliations` — `{ propertyId, businessDate, countedAmount, currency, notes }`. Crea o actualiza el cash count del día.
- `GET /cash/reconciliations?propertyId&date` — lista del día.
- El step `close_day` exige que exista una reconciliation con `discrepancy <= toleranceCents` (0 por defecto, configurable por property).

**Tabla nueva: `cash_drawer_reconciliations`**

- `id`, `tenant_id`, `property_id`, `business_date`, `expected_amount` (sum de payments CASH del día), `counted_amount`, `discrepancy`, `currency`, `counted_by_user_id`, `notes`, `created_at`, `updated_at`.

**Eventos:**

- `cash.reconciliation_created` v1
- `cash.reconciliation_discrepancy` v1 (cuando `|discrepancy| > 0`)

### 2.4 Extensión de copilot — `generate_report`

Nueva FO/NA tool `generate_report`:

- Input: `{ propertyId, businessDate, focus?: 'revenue'|'occupancy'|'incidents'|'overview' }`.
- Output: texto narrativo (LLM-generado o stub determinista) sumarizando los 5 snapshots.
- Read-only → auto-exec por el copiloto (no requiere confirmación humana).
- Tool registrada en `packages/mcp-tools/src/catalog/na.ts` siguiendo el mismo patrón que FO.

---

## 3. Datos y migraciones nuevas

| Migración                              | Tablas                                                     | Notas                                                                    |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `20260510_night_audit`                 | `night_audit_runs`, `night_audit_run_steps` (log de pasos) | RLS + audit + GRANTs                                                     |
| `20260511_night_audit_snapshots`       | `night_audit_snapshots`                                    | RLS + audit + GRANTs; índice `(property_id, business_date, report_type)` |
| `20260512_cash_drawer_reconciliations` | `cash_drawer_reconciliations`                              | RLS + audit + GRANTs                                                     |

---

## 4. Frontend — `apps/web-fo`

### 4.1 Páginas nuevas

- `/night-audit` — estado actual del property (último día cerrado, día actual, botón "Lanzar cierre"). Si hay un run `IN_PROGRESS`/`FAILED`, muestra el step y un botón "Reanudar".
- `/night-audit/[date]` — detalle del día cerrado con totales y enlaces a los 5 reportes.
- `/reports` — selector de día + grid con los 5 reportes (link a detalle).
- `/reports/[type]/[date]` — detalle del reporte + botones de export JSON/CSV/PDF.

### 4.2 Cash count UI

- Bloque inline en `/night-audit` antes de cerrar: input para `countedAmount` por moneda, calcula discrepancy y bloquea el cierre si excede tolerancia.

### 4.3 Copilot

- `generate_report` accesible desde el sidebar; el operador puede pedir "resumen del 10 de junio".

---

## 5. Calidad y verificación

- **Unit:** Vitest sobre cada step + cada report generator + idempotencia. Cobertura objetivo ≥75% en `night-audit/` y `reports/`.
- **Integration:** test con Testcontainers (Postgres + NATS) sobre el flujo `run_started → step_completed (×6) → run_completed → business_day.closed`.
- **E2E (Playwright):** smoke + happy path:
  1. Login → crear reserva → check-in → cargo → conta caja → cerrar día → ver Manager Report.
  2. Reanudar un cierre que falló en `post_taxes`.
  3. Copiloto: "resúmeme el 10/06".
- **CI:** mismo workflow (format/lint/typecheck/test/build).

---

## 6. Plan por semanas (estimación 5-6 semanas)

| Semana | Foco backend                                                                                              | Foco frontend                                        | IA / Compliance               |
| ------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| **1**  | Migraciones + `NightAuditService.run` (esqueleto + 2 steps: post_room_charges + close_day) + idempotencia | `/night-audit` skeleton + lanzar cierre              | —                             |
| **2**  | Resto de steps (taxes, packages, no-shows, snapshot) + reanudable                                         | UI de progreso de steps + reanudar                   | —                             |
| **3**  | Manager Report + Revenue Report + Tax Report (generators + endpoints)                                     | `/reports` + `/reports/manager` + `/reports/revenue` | —                             |
| **4**  | In-house + Arrivals/Departures + CSV export                                                               | resto de páginas de reportes + export                | —                             |
| **5**  | Cash drawer reconciliation + integración con close_day                                                    | UI de cash count + bloqueo de cierre                 | `generate_report` tool stub   |
| **6**  | E2E + bug bash + Testcontainers + RUNBOOK §13                                                             | Polish + accesibilidad                               | UAT con auditor real + hotfix |

---

## 7. Riesgos y mitigaciones

| Riesgo                                                                          | Probabilidad | Impacto | Mitigación                                                                                                             |
| ------------------------------------------------------------------------------- | ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| Reconciliación de cajas no encaja con cómo cuenta el hotel piloto               | Alta         | Medio   | UAT temprano (semana 5); dejar tolerancia configurable                                                                 |
| Steps de cierre tardan demasiado en propiedades grandes (150 habs × N reservas) | Media        | Medio   | Cada step batched + métricas Prometheus desde día 1                                                                    |
| Reportes PDF requieren queue (Puppeteer / Chromium)                             | Media        | Bajo    | PDF detrás de feature flag; CSV/JSON cubren el 90%                                                                     |
| Política de no-show no documentada → cobros incorrectos                         | Media        | Alto    | Si `attributes.noShowPolicy` ausente, no se cobra; se loguea para revisión humana                                      |
| LLM `generate_report` alucina números                                           | Media        | Medio   | El stub determinista se entrena sobre los snapshots; el copiloto siempre cita el `night_audit_snapshots.id` y la fecha |

---

## 8. Salida de Sprint 3 (handoff a Sprint 4)

- Hotel piloto puede operar el cierre nocturno end-to-end.
- Catálogo de eventos NA estable y versionado.
- Catálogo MCP NA documentado.
- Sprint 4 (HSK PWA) puede consumir `night_audit.run_completed` para programar tareas de limpieza diurnas.

---

## 9. Referencias

- [`PROJECT.md`](../PROJECT.md) — documento maestro.
- [`PROJECT.md` ADR-021](../PROJECT.md#adr-021--2026-05-06--sprint-3--mvp-night-audit-completo-sin-recortes-batch-idempotente--reportes-generativos)
- [`docs/SPRINT-2-PLAN.md`](./SPRINT-2-PLAN.md) — Sprint 2 (predecesor).
- [`RUNBOOK.md`](../RUNBOOK.md) — operaciones.
