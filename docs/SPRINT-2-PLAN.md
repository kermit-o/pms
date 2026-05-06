# Sprint 2 — MVP Front Office completo (Aubergine)

> **Versión:** 1.0 — 2026-05-05
> **Branch de planificación:** `claude/plan-hotel-saas-rWaWw`
> **Branch de desarrollo (a abrir):** `claude/sprint-2-mvp-fo` (se reseparará por feature al avanzar)
> **Documento padre:** [`PROJECT.md`](../PROJECT.md) §4.1 + ADR-020.
> **Pre-work:** [`docs/SPRINT-2-PREP.md`](./SPRINT-2-PREP.md) (modelo de datos canónico FO ✅).

---

## 0. Norte estratégico

Salimos de Sprint 2 con un sistema **piloteable por un hotel boutique español real**. No es una demo, no es un subset, no es "lo mínimo". Es el alcance íntegro de PROJECT §4.1 (Front Office), con UI funcional desde el día 1, compliance ES (SES.HOSPEDAJES) y un copiloto conversacional FO básico que demuestra el moat AI-native frente a Opera/Mews/Cloudbeds.

**Definition of Done de Sprint 2:**

1. Recepcionista puede crear, modificar, cancelar y check-in/out una reserva sin tocar SQL.
2. Folio refleja cargos manuales, pagos parciales y splits con auditoría completa.
3. SES.HOSPEDAJES envía el parte diario al servidor de la Guardia Civil correctamente (sandbox).
4. Cardex GDPR: huésped puede ejercer derecho de acceso/rectificación/borrado.
5. Día de operación se puede cerrar (locking) y re-abrir trazablemente.
6. Copiloto en UI ejecuta `create_reservation`, `check_in`, `check_out`, `add_folio_charge`, `assign_room`, `query_availability` con confirmación humana.
7. CI verde, e2e (Playwright) cubre los happy paths, RUNBOOK actualizado, staging Railway redeploy ok.

**Lo que explícitamente NO se entrega en Sprint 2** (no son recortes, son fases siguientes per §4.4 / §10):

- Night Audit (Sprint 3)
- Housekeeping PWA (Sprint 4)
- Channel Manager / OTAs
- Revenue Management
- POS F&B
- Multi-property
- Booking engine propio
- Loyalty

---

## 1. Arquitectura del sprint

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web-fo  (Next.js 15 + React 19 + Tailwind + shadcn/ui)         │
│   - Login OIDC (Keycloak)                                            │
│   - Dashboard ocupación / KPIs                                       │
│   - Calendar Mews-style (rooms × days, drag-to-create)               │
│   - Reservation form (CRUD, walk-in, group)                          │
│   - Cardex (GDPR fields)                                             │
│   - Folio (cargos, pagos, splits)                                    │
│   - Ajustes (rate plans, room types, room status)                    │
│   - Copilot sidebar (Claude → MCP tools)                             │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ REST + WebSocket (SSE)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  apps/api  (NestJS + Fastify, dominios Sprint 2)                     │
│   - reservations/   (CRUD, walk-in, group, locking)                  │
│   - folio/          (entries, payments, splits, close)               │
│   - guests/         (cardex, GDPR, dedup)                            │
│   - rooms/          (status, availability, assignment)               │
│   - rate-plans/     (lectura, asociación a reserva)                  │
│   - compliance/ses-hospedajes/   (XML sender, idempotencia)          │
│   - copilot/        (chat endpoint → MCP)                            │
│   - mcp/fo-tools/   (catálogo MCP de FO)                             │
└─────────┬───────────────────────────────────────┬────────────────────┘
          │ Prisma (RLS via withTenant)           │ NATS pub
          ▼                                       ▼
   PostgreSQL 16                          NATS JetStream
   (RLS, audit log)                       (pms.events.fo.*)
```

**Principios arquitecturales (heredados, sin excepciones):**

- API-first → endpoints REST documentados antes que la UI los consuma.
- Event-driven → cada mutación de dominio publica un evento FO.
- MCP-first → cada caso de uso operacional FO está expuesto como tool.
- Multi-tenant by default → todo pasa por `withTenant`.
- Audit log inmutable → triggers Postgres ya en su sitio.
- Idempotencia → operaciones financieras y de compliance llevan `idempotency_key`.
- GDPR by design → cardex tiene endpoints de access/rectification/erasure.

---

## 2. Dominios y entregables backend

### 2.1 `reservations` — CRUD, walk-in, group bookings

**Endpoints (REST, todos `/api/v1/...`):**

- `POST /reservations` — crear reserva (single).
- `POST /reservations/walk-in` — crear reserva walk-in (arrival = today, sin pre-stay).
- `POST /reservations/groups` — crear grupo (header + N reservas hijas).
- `GET /reservations` — listar con filtros (`from`, `to`, `status`, `guestId`, `roomId`, paginación cursor).
- `GET /reservations/:id` — detalle (incluye huéspedes, folio, history).
- `PATCH /reservations/:id` — modificar (fechas, room type, rate plan, occupancy).
- `POST /reservations/:id/cancel` — cancelar (registra motivo, política aplicada).
- `POST /reservations/:id/check-in` — check-in (asigna habitación si falta, valida cardex, dispara registro SES).
- `POST /reservations/:id/check-out` — check-out (valida folio paid, libera habitación).
- `POST /reservations/:id/no-show` — marcar no-show (registra penalty fee si política).
- `POST /reservations/:id/assign-room` — asignar / cambiar habitación.

**Reglas de dominio:**

- Estados (enum): `BOOKED`, `CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`, `NO_SHOW`.
- Transiciones validadas en service (`ReservationStateMachine`).
- `arrival < departure`. Mínimo 1 noche.
- Walk-in: `arrival = today`, status saltea a `CHECKED_IN` si la operación lo pide.
- Group booking: tabla `reservation_group` con `block_id`, hijos `reservation` con `group_id`. Cancelar grupo = cancelar todas (transacción).
- Locking: si `business_date` está cerrado y la reserva tocaba ese día, mutación rechazada (excepto rectificación con `override_token` de admin).

**Eventos publicados (subjects `pms.events.fo.*`):**

- `reservation.created` v1
- `reservation.updated` v1
- `reservation.cancelled` v1
- `reservation.checked_in` v1
- `reservation.checked_out` v1
- `reservation.no_show` v1
- `reservation.room_assigned` v1
- `reservation.group_created` v1

### 2.2 `folio` — cargos, pagos, splits, locking

**Endpoints:**

- `GET /folios/:id` — detalle (entries, balance, status).
- `POST /folios/:id/charges` — cargo manual (concepto, importe, tax, idempotency_key).
- `POST /folios/:id/payments` — pago (parcial o total, método, idempotency_key).
- `POST /folios/:id/split` — dividir folio (master + child folios para split de pagos por huésped).
- `POST /folios/:id/close` — cerrar folio (sólo si balance == 0; emite `folio.closed`).
- `POST /folios/:id/reopen` — reabrir (admin, registra motivo).
- `POST /folios/:id/transfer` — transferir entries entre folios (split correctivo).

**Reglas:**

- `FolioEntry` es append-only: una vez insertada, sólo se contrarresta con una entry inversa (signo opuesto). Nunca UPDATE/DELETE de filas existentes.
- `idempotency_key` único por `(folio_id, key)` durante 24h → request duplicado retorna la misma entry.
- Pago marcado con `payment_method` (cash, card, bank_transfer, other) + `reference`.
- Locking: si día de operación cerrado y la entry pertenece a ese día, mutaciones rechazadas.

**Eventos:**

- `folio.charge_added` v1
- `folio.payment_received` v1
- `folio.split` v1
- `folio.closed` v1
- `folio.reopened` v1

### 2.3 `guests` — cardex GDPR

**Endpoints:**

- `POST /guests` — crear huésped (con dedup heurístico: email + dni/passport hash).
- `GET /guests/:id` — detalle.
- `PATCH /guests/:id` — actualizar.
- `GET /guests/:id/access-export` — GDPR access right (export ZIP JSON).
- `POST /guests/:id/erase` — GDPR erasure (anonimiza, conserva entries financieras como `[REDACTED]`).
- `POST /guests/dedup` — herramienta admin: merge de duplicados.

**Reglas:**

- Campos compliance ES: `document_type` (DNI / NIE / PASSPORT / OTHER), `document_number`, `nationality`, `birth_date`, `address`.
- Hash determinista en `document_hash` para dedup sin exponer PII en queries.
- Erasure: tras retention period (5 años por compliance hotelera ES), permitir borrado real; antes, sólo anonimización.

**Eventos:**

- `guest.created` v1
- `guest.updated` v1
- `guest.merged` v1
- `guest.erased` v1
- `cardex.synced` v1 (cuando el cardex de una reserva queda completo y listo para SES)

### 2.4 `rooms` — estado, disponibilidad, asignación

**Endpoints:**

- `GET /rooms` — listar (filtros: roomTypeId, status, floor).
- `GET /rooms/availability` — matriz `[room][date] → status` para el calendar.
- `POST /rooms/:id/status` — cambiar estado (Clean / Dirty / Inspected / OOO / OOS) — Sprint 2 setea las bases; lógica HSK completa en Sprint 4.
- `GET /rooms/availability/search` — buscar habitaciones libres para `(roomTypeId, arrival, departure)` con preferencias.

**Reglas:**

- `room.status` y `room.assigned_reservation_id` son consistentes (constraint).
- Cambio de habitación durante stay registra evento `reservation.room_assigned` con `previous_room_id`.

**Eventos:**

- `room.status_changed` v1
- `room.assigned` v1 (alias dual con `reservation.room_assigned` para conveniencia HSK)

### 2.5 `rate-plans` — sólo lectura en MVP

- `GET /rate-plans` — listar.
- `GET /rate-plans/:id` — detalle (precios por roomType + temporada).
- Mutaciones quedan en admin manual (seed) en Sprint 2; UI de RM llega en Sprint 3+.

### 2.6 `compliance/ses-hospedajes` — sender XML

**Endpoint operativo:**

- `POST /compliance/ses-hospedajes/submissions` — fuerza envío inmediato (manual override).
- `GET /compliance/ses-hospedajes/submissions` — lista envíos (queued / sent / failed) por fecha.
- `GET /compliance/ses-hospedajes/submissions/:id` — detalle (XML enviado, respuesta, retries).

**Workflow automático:**

- Cron diario 00:30 local: agrupa cardex completados del día anterior, genera XML SES.HOSPEDAJES, encola en `pms.events.fo.compliance.ses_submission_due`.
- Worker consume, firma, envía a endpoint Guardia Civil (sandbox URL en config).
- Reintentos exponenciales (1m, 5m, 30m, 4h, 24h). Tras 5 fallos → DLQ + alerta.
- Idempotencia por `business_date + property_id`.

**Tabla nueva:**

- `ses_hospedajes_submission`: `id`, `tenant_id`, `property_id`, `business_date`, `status`, `xml_payload`, `xml_signature`, `submitted_at`, `response_code`, `response_body`, `retry_count`, `last_error`.

**Eventos:**

- `compliance.ses_submission_queued` v1
- `compliance.ses_submission_sent` v1
- `compliance.ses_submission_failed` v1

### 2.7 `copilot` + `mcp/fo-tools`

**MCP tools (catálogo `packages/mcp-tools/src/catalog/fo/`):**

| Tool                 | Input schema (Zod)                                          | Output                                                                      | Side-effects                        |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| `query_availability` | `{ from, to, roomTypeId? }`                                 | matriz disponibilidad                                                       | none (read-only)                    |
| `create_reservation` | `{ guestId                                                  | guestData, arrival, departure, roomTypeId, ratePlanId, occupancy, notes? }` | `{ reservationId }`                 | publish `reservation.created` |
| `check_in`           | `{ reservationId, roomId? }`                                | `{ ok, reservationId, roomId }`                                             | publish `reservation.checked_in`    |
| `check_out`          | `{ reservationId, settle: bool }`                           | `{ ok, reservationId, balance }`                                            | publish `reservation.checked_out`   |
| `add_folio_charge`   | `{ folioId, description, amount, taxRate, idempotencyKey }` | `{ entryId }`                                                               | publish `folio.charge_added`        |
| `assign_room`        | `{ reservationId, roomId }`                                 | `{ ok }`                                                                    | publish `reservation.room_assigned` |

**Copilot endpoint:**

- `POST /copilot/sessions` — abre sesión.
- `POST /copilot/sessions/:id/messages` — envía mensaje, retorna respuesta (con tool_use sugerido).
- `POST /copilot/sessions/:id/confirm-tool` — humano confirma ejecución del tool sugerido.

**Reglas de seguridad:**

- Todas las tools requieren `tenantId` del JWT del usuario que abrió la sesión. El LLM no puede falsificarlo.
- Acciones financieras (`add_folio_charge`, `check_out`+`settle`) **siempre** requieren confirm-tool humano. La UI muestra preview + botón Confirmar.
- Las queries (`query_availability`) se auto-ejecutan.

---

## 3. Frontend — `apps/web-fo`

### 3.1 Stack y scaffolding

- Next.js 15 (App Router) + React 19.
- Tailwind v4.
- shadcn/ui (componentes locales, no librería externa).
- TanStack Query para data fetching.
- `next-auth` v5 con provider OIDC apuntando a Keycloak realm `pms`.
- Server Actions para mutaciones simples; tRPC fuera de alcance (REST directo está bien).
- E2E con Playwright (`apps/web-fo/e2e/`).

### 3.2 Páginas / rutas

- `/login` — redirige a Keycloak.
- `/` — dashboard (KPIs hoy: arrivals, departures, in-house, occupancy %, ADR).
- `/calendar` — Mews-style grid (rooms en filas, días en columnas, drag para crear reserva).
- `/reservations` — lista + filtros.
- `/reservations/new` — formulario crear (single + walk-in).
- `/reservations/group` — formulario grupo.
- `/reservations/:id` — detalle (tabs: Stay, Cardex, Folio, History).
- `/guests` — lista huéspedes.
- `/guests/:id` — cardex completo + acciones GDPR.
- `/rooms` — estado + matriz.
- `/compliance/ses` — submissions list (status + retry button).
- `/settings/rate-plans` — lectura.
- `/settings/room-types` — lectura.
- Sidebar persistente con copiloto (`Cmd+K` para abrir).

### 3.3 Branding

- Wordmark: **Aubergine** (sans-serif, color `#5C2A4D` placeholder hasta brand pass).
- Tagline: "AI-native PMS for boutique hotels".
- Favicon + OG image — placeholder Sprint 2, brand pass real Sprint 3.

---

## 4. Datos y migraciones nuevas

Sprint 2 añade sobre el pre-work:

- `reservation_group` (header de grupo).
- `payment` (relación opcional con `folio_entry`).
- `ses_hospedajes_submission`.
- `idempotency_key` (`scope`, `key`, `entity_id`, `created_at`) para deduplicación cross-domain.
- `business_day_state` (`property_id`, `business_date`, `status: open|closed`, `closed_at`, `closed_by_user_id`).

Todas con RLS, GRANTs a `pms_app`, audit triggers.

---

## 5. Calidad y verificación

- **Unit:** Vitest sobre services y state machine de reservas. Cobertura objetivo: ≥70% en `reservations/`, `folio/`, `compliance/`.
- **Integration:** tests con Testcontainers (Postgres + NATS) sobre los flujos reservation→folio→ses.
- **E2E:** Playwright cubre:
  1. Login → crear reserva → check-in → cargo → pago → check-out.
  2. Walk-in → check-in inmediato.
  3. Group booking → cancelar grupo.
  4. Cardex GDPR access export.
  5. SES submission (mock endpoint Guardia Civil).
  6. Copiloto: "crea una reserva del Sr. García del 10 al 13" → confirm → reserva creada.
- **CI:** GitHub Actions con stages lint → typecheck → test → e2e → build docker.
- **Manual UAT:** RUNBOOK §13 nuevo con guion de prueba para hotel piloto.

---

## 6. Plan por semanas (estimación)

> **Nota:** estimación con 1 dev humano + Claude Code, side-project. Ajustable.

| Semana | Foco backend                                          | Foco frontend                                     | Foco compliance/IA                   |
| ------ | ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| **1**  | Reservations CRUD + state machine + walk-in           | Scaffold web-fo + login OIDC + dashboard skeleton | —                                    |
| **2**  | Group bookings + assign-room + reservations.\* events | Calendar Mews-style + reservation form            | —                                    |
| **3**  | Folio (charges, payments, splits) + idempotencia      | Reservation detail + folio UI                     | —                                    |
| **4**  | Guests cardex + GDPR endpoints                        | Cardex UI + guests list                           | —                                    |
| **5**  | Rooms availability + business-day locking             | Rooms matrix + close-day UI                       | —                                    |
| **6**  | —                                                     | E2E Playwright + bug bash                         | SES.HOSPEDAJES sender + worker + DLQ |
| **7**  | MCP FO tools + copiloto endpoint                      | Copilot sidebar + confirm-tool flow               | UAT con hotel piloto + hotfix        |

---

## 7. Riesgos y mitigaciones

| Riesgo                                                            | Probabilidad    | Impacto | Mitigación                                                                      |
| ----------------------------------------------------------------- | --------------- | ------- | ------------------------------------------------------------------------------- |
| Spec real SES.HOSPEDAJES más compleja de lo asumido               | Media           | Alto    | Sprint 6 reserva buffer; reunión temprana con asesor fiscal/legal ES            |
| Calendar Mews-style consume tiempo (drag, virtual scrolling)      | Alta            | Medio   | Empezar con tabla simple en S2-W2, mejorar incremental                          |
| Copiloto + tools financieras = riesgo regulatorio si auto-ejecuta | Baja (mitigada) | Alto    | Confirmación humana siempre; ADR-020 fija el guardrail                          |
| Validación con hoteles llega tarde y obliga a re-modelar          | Media           | Medio   | Pre-work ya cubrió el shape canónico (ADR-018); cambios deberían ser de copy/UX |
| Performance Calendar con 150 habs × 90 días                       | Media           | Medio   | Virtualización (TanStack Virtual) desde el primer commit del calendar           |
| Drift entre eventos publicados y catálogo Zod                     | Media           | Medio   | CI verifica que cada `publish()` usa una entry del catálogo                     |

---

## 8. Salida de Sprint 2 (handoff a Sprint 3)

- Aubergine FO operativo en Railway staging.
- 1 hotel piloto candidato identificado y, si posible, firmado para UAT.
- Catálogo de eventos FO estable y versionado.
- Catálogo MCP FO documentado en `packages/mcp-tools/README.md`.
- Sprint 3 = MVP NA (Night Audit) puede arrancar consumiendo eventos FO del bus.

---

## 9. Referencias

- [`PROJECT.md`](../PROJECT.md) — documento maestro.
- [`PROJECT.md` ADR-020](../PROJECT.md#adr-020--2026-05-05--sprint-2--mvp-fo-completo-sin-recortes-ui-desde-día-1) — decisión de scope.
- [`docs/SPRINT-2-PREP.md`](./SPRINT-2-PREP.md) — pre-work del modelo de datos.
- [`docs/HOTEL-DISCOVERY.md`](./HOTEL-DISCOVERY.md) — guion de entrevistas (continúa en paralelo).
- [`RUNBOOK.md`](../RUNBOOK.md) — operaciones (§12 Railway).
