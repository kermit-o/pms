# Aubergine PMS · Delivery Log

> **Append-only log.** Cada tarea cerrada, decisión arquitectónica, fix o
> cambio operativo se registra aquí. Es el diario del proyecto.
>
> **Reglas del log** (también en `CLAUDE.md §6.3`):
>
> 1. **Append-only.** No se reescriben entradas pasadas. Si una decisión se
>    revierte, se añade una entrada nueva que la supersede y enlaza la anterior.
> 2. **Más reciente arriba.** El último entry queda visible al abrir el archivo.
> 3. **Una entrada por unidad de trabajo cerrada** (PR mergeado, sprint
>    cerrado, ADR firmado, hotfix desplegado).
> 4. **Formato estricto** (ver §1). Si no encaja en el formato, no encaja en
>    el log — abre una entrada de tipo `[NOTE]` para casos raros.
> 5. **Claude Code apunta aquí siempre que cierra una tarea**, antes de
>    reportar "done".
>
> Este archivo **no sustituye** a:
>
> - `PROJECT.md` — estado actual del producto y dirección.
> - `docs/SPRINT-N-PLAN.md` — plan por sprint.
> - `docs/adr/NNN-*.md` — decisiones arquitectónicas detalladas.
> - `RUNBOOK.md` — playbooks operativos.
>
> Los complementa: PROJECT.md dice "dónde estamos", este log dice "cómo
> llegamos hasta aquí".

---

## 1 · Formato de entrada

````markdown
## YYYY-MM-DD · [TIPO] · Título corto (≤ 80 chars)

**Scope:** módulos/paquetes afectados
**Branch:** rama donde se desarrolló
**Refs:** PR #N · commit `abc1234` · ADR-NNN

**Qué cambió.**

- Bullet 1
- Bullet 2

**Por qué.**

Una o dos frases.

**Archivos clave.**

- `apps/api/src/x/y.ts`
- `packages/db/prisma/schema.prisma`

**Sigue pendiente.**

(Opcional) Lo que queda colgando o se difiere a otra entrada.
````

### Tipos válidos

| Tipo | Cuándo usarlo |
|---|---|
| `[FEAT]` | Funcionalidad nueva visible al usuario u operador. |
| `[FIX]` | Bug fix en código de producción. |
| `[REFACTOR]` | Cambio interno sin alterar comportamiento. |
| `[DOCS]` | Solo documentación. |
| `[INFRA]` | Cambios en CI/CD, Fly, Postgres, secrets, networking. |
| `[DB]` | Migración Prisma, cambio de RLS, índice, particionado. |
| `[SECURITY]` | Hardening, parche CVE, auth, RLS leak. |
| `[COMPLIANCE]` | PCI, GDPR, SES.HOSPEDAJES, Verifactu. |
| `[INTEGRATION]` | Stripe, Keycloak, NATS, channel manager, etc. |
| `[ADR]` | Decisión arquitectónica formal (también en `docs/adr/`). |
| `[SPRINT]` | Cierre de sprint completo. |
| `[INCIDENT]` | Postmortem de incidente de producción. |
| `[CHORE]` | Mantenimiento (deps, lockfile, formato). |
| `[NOTE]` | Cualquier cosa que no encaja arriba. |

---

## 2 · Entradas (más recientes primero)

---

## 2026-05-16 · [DOCS] · Sincronizar PROJECT.md con el estado real del repo

**Scope:** docs
**Branch:** `claude/adr-023-cdg-region`
**Refs:** este commit

**Qué cambió.**

- `PROJECT.md §0`: nueva entrada describiendo el track "Commercial-grade"
  desarrollado en `claude/adr-023-cdg-region` (reservations UI v2 Iter A,
  calendar v2, wizard 3-step, garantía/cancelación Corte A, groups Fase 1-2,
  Stripe SetupIntent Fase 1, process docs).
- Estado del workstream Copilot de Sprint 6 marcado como en curso 🟢, con
  los workstreams restantes (anomaly/voice/forecast/embedded) declarados
  pendientes.
- Branch de desarrollo actual actualizado: `claude/adr-023-cdg-region`
  (antes apuntaba a `claude/sprint-6-plan`, obsoleto).
- `§11` (reglas de trabajo): nuevas reglas 6-8 referencian `DELIVERY-LOG.md`
  y `CLAUDE.md`; numeración corregida (idioma código → 9, idioma docs → 10).
- Fecha de "Última actualización" → 2026-05-16.

**Por qué.**

`PROJECT.md` estaba congelado en 2026-05-07 declarando como "Fase actual"
todo Sprint 6 IA V1 sin reflejar el track paralelo que hemos construido
estas dos semanas. Eso forzaba a Claude Code a tirar de memoria de
conversación en vez de la fuente de verdad, y a usuarios externos a
ignorar lo que realmente está disponible en el repo.

**Archivos clave.**

- `PROJECT.md`

**Sigue pendiente.**

- Decidir si la rama `claude/adr-023-cdg-region` se mergea a `main` antes
  o después de cerrar más workstreams Sprint 6.
- Reservations UI v2 Iter B (schema fields Agencia/Empresa/VIP).
- Stripe Fase 2 (cobro off-session no-show).
- Workstreams Sprint 6: anomaly NA, voice HSK, forecast, embedded copilot.

---

## 2026-05-16 · [DOCS] · Crear DELIVERY-LOG y anclarlo en CLAUDE.md

**Scope:** docs, raíz
**Branch:** `claude/adr-023-cdg-region`
**Refs:** este commit

**Qué cambió.**

- Nuevo `docs/DELIVERY-LOG.md` (este archivo): formato append-only, tipos
  válidos, reglas de uso.
- `CLAUDE.md §6.3` actualizado: la Definition of Done ahora exige añadir
  entrada al log antes de reportar "done".
- `CLAUDE.md §16` (jerarquía de fuentes) incorpora el log como fuente nº 4
  para responder "¿ya tenemos X?".
- Backfill de entradas desde inicio de la rama `claude/adr-023-cdg-region`
  hasta hoy (copilot, groups Fase 1-2, reservations v2 Iter A, Stripe Fase 1,
  client-side confirm fallback, fix de botón con guaranteeType=NONE, docs
  de fly.toml, CLAUDE.md).

**Por qué.**

Sin un log append-only, PROJECT.md (que es "estado actual") se desactualiza
y Claude Code termina respondiendo "qué hacemos siguiente" basado en
memoria de conversación en vez de hechos del repo. El log fija una fuente
verificable de "qué ya hicimos", y la regla en CLAUDE.md cierra el bucle:
ninguna tarea se cierra sin apuntarla.

**Archivos clave.**

- `docs/DELIVERY-LOG.md`
- `CLAUDE.md`

---

## 2026-05-16 · [DOCS] · Crear CLAUDE.md como instrucciones core

**Scope:** raíz del repo
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `b525218`

**Qué cambió.**

- Nuevo archivo `CLAUDE.md` en la raíz: misión, stack inmutable, glosario,
  Definition of Ready/Done, qué puede y qué NO puede hacer Claude Code
  autónomamente, control de drift, jerarquía de fuentes, gotchas aprendidas
  en esta sesión.

**Por qué.**

Ancla a Claude Code a la misión Aubergine y al stack actual. Define la
frontera entre lo autónomo y lo que requiere intervención humana (deploys,
push a `main`, secrets, dashboards externos). Las gotchas recogen aprendizajes
de esta sesión (flyctl sin `--build-context`, fallback de Stripe webhook,
RLS silencioso).

**Archivos clave.**

- `CLAUDE.md`

---

## 2026-05-16 · [DOCS] · PMS domain reference como mapa mental del roadmap

**Scope:** docs
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `f792dda`

**Qué cambió.**

- Nuevo `docs/PMS-DOMAIN-REFERENCE.md` con departamentos del proyecto,
  ciclo de vida de tareas, y mapa de módulos PMS para evitar drift.

**Por qué.**

Visión de consultoría (Itransition-style): qué departamentos intervienen,
cómo fluye una tarea de intake a learn, cómo encajan los módulos PMS.

---

## 2026-05-16 · [DOCS] · Actualizar comentario obsoleto de fly.toml

**Scope:** `apps/api`, `apps/web-fo`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `25bd698`

**Qué cambió.**

- `apps/api/fly.toml`: comentario de deploy cambia de `--build-context .`
  (flag inexistente en flyctl actual) a `--dockerfile apps/api/Dockerfile`.
- Mismo cambio en `apps/web-fo/fly.toml`.

**Por qué.**

Durante el deploy fallaron 2 builds porque el comentario prescribía un flag
que flyctl ya no soporta. El working directory es el contexto; lo único que
se pasa es `--dockerfile`.

---

## 2026-05-16 · [FEAT] · Capturar tarjeta Stripe también con guaranteeType=NONE

**Scope:** `apps/web-fo`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `d12ff5d`

**Qué cambió.**

- En `GuaranteeCard` (detalle de reserva), el botón "Capturar tarjeta
  (Stripe)" aparece cuando `status ∈ {PENDING, FAILED}` y
  `type ∈ {CARD_ON_FILE, NONE}` (antes solo `CARD_ON_FILE`).
- Hint UI explica que capturar la tarjeta cambia el tipo a CCG.

**Por qué.**

Reservas walk-in y muchas creadas en Booking quedaban con `guaranteeType =
NONE`, lo que ocultaba el botón. El backend ya fija `CARD_ON_FILE` cuando
crea el SetupIntent, así que es seguro mostrarlo siempre que la garantía
esté pendiente.

**Archivos clave.**

- `apps/web-fo/src/app/reservations/[id]/page.tsx`

---

## 2026-05-16 · [INTEGRATION] · Stripe SetupIntent — confirm fallback cliente→servidor

**Scope:** `apps/api/payments`, `apps/web-fo`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `c0077fb`

**Qué cambió.**

- Nuevo endpoint API `POST /payments/stripe/reservations/:id/confirm-setup-intent`
  que retrae el SI desde Stripe server-side y marca `guaranteeStatus = SECURED`
  idempotente. Reusa el flow del webhook.
- Nuevo proxy Next.js `apps/web-fo/src/app/api/payments/confirm-setup-intent/[id]/route.ts`.
- `StripeCardCapture` y `StripeCaptureButton` reciben `reservationId` y, tras
  un `stripe.confirmSetup` exitoso, llaman al confirm endpoint antes de cerrar
  el modal.

**Por qué.**

El Dashboard de Stripe del cliente no permite suscribir `setup_intent.succeeded`
al endpoint creado ("evento no compatible con este destino"). Sin webhook
funcionando, la reserva quedaba en `PENDING` indefinidamente. El fallback
cliente→servidor cierra el ciclo sin depender del webhook. El webhook sigue
siendo el path autoritativo cuando está disponible.

**Archivos clave.**

- `apps/api/src/payments/stripe.service.ts` (`confirmSetupIntent`)
- `apps/api/src/payments/stripe.controller.ts`
- `apps/web-fo/src/components/StripeCardCapture.tsx`
- `apps/web-fo/src/components/StripeCaptureButton.tsx`
- `apps/web-fo/src/app/api/payments/confirm-setup-intent/[id]/route.ts`

---

## 2026-05-15 · [INTEGRATION] · Stripe SetupIntent · tokenización real (Corte B Fase 1)

**Scope:** `apps/api/payments`, `apps/web-fo`, `packages/db`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `5c462b0`

**Qué cambió.**

- Migración Prisma `20260607000000_stripe_payment_method` añade 7 columnas
  Stripe a `reservations` (`stripe_customer_id`, `stripe_setup_intent_id`,
  `stripe_payment_method_id`, `stripe_card_brand`, `stripe_card_last4`,
  `stripe_card_exp_month`, `stripe_card_exp_year`) + índice por SI id.
- Nuevo `PaymentsModule` (NestJS) con `StripeService` y `StripeController`.
- Endpoints: `POST /setup-intent` (crea/reusa SI), `POST /webhook` (signature
  verificada con rawBody).
- Fastify configurado con `rawBody: true` para firma webhook.
- 3 env vars opcionales: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`. Si no están, el módulo lanza 503 y el operador
  sigue pudiendo usar garantía manual.
- Frontend: `StripeCardCapture` (modal con Elements) + `StripeCaptureButton`
  integrado en `GuaranteeCard` del detalle de reserva.

**Por qué.**

Cierra el primer corte real de "commercial-grade": el operador puede
tokenizar tarjetas vía Stripe Elements sin que PAN toque nuestros servidores
(PCI SAQ A). Reservation queda `SECURED` con `**** 1234 (brand)`. Habilita
Fase 2 (cobro off-session para no-show).

**Archivos clave.**

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260607000000_stripe_payment_method/migration.sql`
- `apps/api/src/payments/*`
- `apps/api/src/config/env.schema.ts`
- `apps/api/src/main.ts` (rawBody)

**Sigue pendiente.**

- Stripe Fase 2: cobro off-session de no-show con `PaymentIntent`.
- Estado de la garantía visible en la lista de reservas con brand+last4.

---

## 2026-05-14 · [FEAT] · Reservations UI v2 · smart search + filtros + tabla Opera-like

**Scope:** `apps/web-fo`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `3c2a4b7`

**Qué cambió.**

- Nueva tabla de reservas con 16 columnas: Código, Hab., Tipo, Huésped,
  Llegada, Salida, N, PAX, Rate/n, Balance, Rate, Agencia/Empresa, Group,
  Estado, Garantía, Source.
- Smart search regex-based + 9 quick chips (Llegadas hoy, Salidas hoy,
  In-house, Pendientes, Garantía pendiente, Sin habitación, Walk-ins hoy,
  Cancelados 7d, Mañana) + filtros avanzados colapsables.
- 3 rutas nuevas con presets: `/arrivals`, `/departures`, `/in-house`.
- Shell reutilizable `renderReservationsList` para no duplicar layout.
- Nav del header actualizado: Calendario · Reservas · Llegadas · Salidas ·
  In-house · Dashboard · Habitaciones · Cardex · Cierre día · Night audit ·
  Reportes.

**Por qué.**

UX al nivel de Opera pero AI-native (smart search + chips). Recepción ya
no clica 5 filtros para llegar a "llegadas de hoy". Iter A; Iter B
(schema fields Agencia/Empresa/VIP) pendiente.

**Archivos clave.**

- `apps/web-fo/src/components/ReservationsTable.tsx`
- `apps/web-fo/src/components/ReservationsFilters.tsx`
- `apps/web-fo/src/components/ReservationsListPage.tsx`
- `apps/web-fo/src/lib/reservations-query.ts`
- `apps/web-fo/src/app/{arrivals,departures,in-house}/page.tsx`

**Sigue pendiente.**

- Iter B: añadir `agencyName`, `companyName`, `Guest.membershipLevel` al
  schema y poblar las columnas vacías.

---

## 2026-05-13 · [FIX] · Feedback visual en bulk ops + columna Habitación en tabla grupo

**Scope:** `apps/web-fo/reservations/groups`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `e152b28`

**Qué cambió.**

- `findGroup` devuelve `room.number` por reserva.
- Tabla del grupo añade columna "Habitación".
- Bulk actions hacen redirect con `?flash=...` para mostrar banner verde
  confirmando "13 habitaciones asignadas".

**Por qué.**

El usuario reportó "no funcionó" cuando en realidad la operación había
asignado 13 habitaciones — faltaba feedback visible.

---

## 2026-05-12 · [FEAT] · Group reservations Fase 2 · bulk operations

**Scope:** `apps/api/reservations`, `apps/web-fo`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `89b5aa5`

**Qué cambió.**

- API: `POST /reservations/groups/:id/bulk-assign-rooms`,
  `bulk-check-in`, `bulk-check-out`.
- DTOs validadores con Zod.
- UI: botones de acción masiva en página detalle del grupo.

**Por qué.**

Recepción tarda 20 min en hacer check-in a un grupo de 13 habs una por
una. Con bulk: 1 clic.

---

## 2026-05-11 · [FEAT] · Group reservations Fase 1 · página detalle + patch/cancel masivo

**Scope:** `apps/api/reservations`, `apps/web-fo/reservations/groups`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commit `65bd509`

**Qué cambió.**

- API: `findGroup`, `patchGroup` (cascade a reservas no terminales),
  `cancelGroup`.
- Página `/reservations/groups/[id]` con tabla de reservas del grupo y
  controles de cascada.
- Edits individuales por reserva siguen funcionando (no se rompió la
  granularidad).

**Por qué.**

Cambios en bloque (fechas, room type, rate plan) son operativos diarios
en grupos/allotments. La cascada respeta reservas ya en CHECKED_IN o
CANCELLED.

---

## 2026-05-10 · [FEAT] · Copilot · estabilización Sonnet 4.6 + agentic loop

**Scope:** `apps/api/copilot`, `packages/mcp-tools`
**Branch:** `claude/adr-023-cdg-region`
**Refs:** commits `36c0a89` → `f13213d`

**Qué cambió.**

- Adapter Anthropic con tool catalog real (Sonnet 4.6).
- Agentic loop interno que encadena read-only tools sin ruido al usuario.
- Tools nuevas: `list_room_types`, `search_availability_by_type`,
  `create_reservation_group`.
- Pre-validación Zod del `tool_use`: si el payload falla, se devuelve el
  error al LLM como `tool_result` y reintenta.
- Guard contra UUIDs inventados por el LLM.
- Iter limit subido a 12 para grupos largos.

**Por qué.**

El copilot estaba alucinando UUIDs, devolviendo arrays vacíos en grupos
y pidiendo confirmaciones textuales en lugar de ejecutar. Con la
validación Zod en el loop y un system prompt más estricto, los flujos de
grupos quedaron estables.

**Sigue pendiente.**

- Eval set ≥ 50 casos por tool antes de promoverlo a producción real.

---

## Anterior a esta sesión

Estados consolidados en `PROJECT.md`:

- **Sprint 1** (Foundation) — PR #2 mergeado.
- **Sprint 1.5** (Polish + Railway staging) — PR #2/#4/#5 mergeados.
- **Sprint 2 pre-work** (Modelo de datos FO) — PR #3 mergeado.
- **Sprint 2** (MVP FO completo) — PR #6 mergeado.
- **Sprint 3** (MVP Night Audit) — PR #7 mergeado.
- **Sprint 4** (MVP Housekeeping + PWA) — PR #8 mergeado.
- **Sprint 5** (Piloto en producción · Fly cdg) — PRs #9–#21 mergeados.

A partir de ahora, cada cierre se registra como entrada nueva arriba.

---

_Mantenimiento: este archivo se actualiza con cada PR que merge a `main` o
con cada commit que cierra una tarea identificable. Si una entrada queda
incompleta, marcar con `**Sigue pendiente.**` y abrir nueva entrada cuando
se cierre lo restante._
