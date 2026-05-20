# Sprint 12 — Operador productivity + cierre de loose ends

> **Versión:** 1.0 — 2026-05-21
> **Branch del plan:** `claude/s12-plan`. Workstreams en `claude/s12-w<N>-<topic>`.
> **Documento padre:** Sprint 11 §8 (handoff) + PROJECT.md §4.4.
> **Predecesores:** Sprint 11 cerrado en producción (Postmark webhook,
> NATS consumer, Stripe hardening, Grafana).

---

## 0. Norte estratégico

Producción ya tiene los 4 dominios críticos sólidos (IBE, CM, payments,
notifications). Lo que el piloto necesita ahora es **productividad del
operador** del hotel y **cerrar las pequeñas deudas** que dejaron los
sprints anteriores.

Cuatro bloques:

1. **Cerrar pending de S11 W2** — migrar
   `PublicOnboardingService.start` a `enqueueEmail` y extender el
   catálogo `email.send_requested` para aceptar `onboarding_verify`.
   Se quedó fuera porque la rama de S11 W2 partió antes de mergear
   S9 W3.
2. **Reports export CSV** — los hoteles viven de Excel. Endpoint nuevo
   que sirve los reportes ya generados por NA (`night_audit_snapshots`)
   como CSV descargable + UI button.
3. **Pre-pago full PaymentIntent on-session** — tarifas no
   reembolsables piden cobro upfront, no solo SetupIntent. Toggle por
   reserva al crearla desde IBE (manage rate) o desde el back-office.
4. **Calendar drag & drop check-in/check-out** — operador productivity.
   El calendario actual (S2) lista reservas. Drag → check-in / drop
   sobre otra fecha → cambio de estancia.

**Definition of Done de Sprint 12:**

1. **Onboarding enqueueEmail**: `PublicOnboardingService.start` publica
   `email.send_requested` en lugar de `sendEmail` inline. Catálogo
   acepta `onboarding_verify` como template válido. Tests verdes.
2. **Reports CSV export**: `GET /reports/:type/export.csv?from=&to=&propertyId=`
   devuelve `text/csv` con `Content-Disposition: attachment; filename=...`.
   Tipos soportados V1: `daily_revenue`, `occupancy`, `tax_breakdown`,
   `cash_movements`. UI: botón "Descargar CSV" en `/reports/[type]`.
3. **Pre-pago PaymentIntent**: nuevo flow `createPaymentIntent` que crea
   un PI con `confirm: true` desde el IBE (`/book` → "Tarifa no
   reembolsable, paga ahora"). Marca la reserva `guaranteeStatus =
   SECURED` + entrada en folio `PAYMENT` con
   `attributes.stripePaymentIntentId`. Idempotente por reservationId.
4. **Calendar drag & drop**: en `/calendar`, drag de reserva PENDING
   → CHECKED_IN si la fecha de drop = today. Drop de reserva
   CHECKED_IN sobre fecha futura → CHECKED_OUT_OVERSTAY (placeholder).
   Conflict resolution: si la habitación destino está ocupada,
   modal de confirmación.

**Lo que NO se entrega:**

- Memoria semántica V1.1 (sigue bloqueada por dep `openai`).
- 2º channel manager provider (Cloudbeds/RoomCloud) — Sprint 13 si
  primer piloto lo pide.
- Multidivisa real (V2).
- White-label subdominio + CSS custom.
- Loyalty / promo codes (V2).
- Auditoría SOC 2.
- Reports PDF (Sprint 13 con `puppeteer` ADR aprobada).

---

## 1. Workstreams

```
┌──────────────────────────────────────────────────────────────────────┐
│  W1 — Cierre pending S11 W2 (enqueueEmail + catálogo)                │
│   - packages/eventbus/src/catalog/notifications.ts                   │
│   - apps/api/public-onboarding/public-onboarding.service.ts          │
│   - Tests actualizados                                               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W2 — Reports export CSV                                             │
│   - apps/api/reports/reports.controller.ts (endpoint nuevo)          │
│   - apps/api/reports/csv-formatter.ts                                │
│   - apps/web-fo/src/app/reports/[type]/page.tsx — botón descargar    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W3 — Pre-pago full PaymentIntent on-session                         │
│   - apps/api/payments/stripe.service.ts (createPaymentIntent)        │
│   - apps/api/public-ibe — DTO con paymentMode='setup'|'charge'       │
│   - apps/web-ibe — selector de tarifa con badge "no reembolsable"    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W4 — Calendar drag & drop                                           │
│   - apps/web-fo/src/app/calendar/page.tsx                            │
│   - Cliente React (HTML5 DnD nativo, sin libs)                       │
│   - Server actions: transición check-in/check-out                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios:**

- Sin nuevas deps npm.
- Forward-only migrations (W3 reusa columnas Stripe ya existentes).
- Las cuatro features tienen flag implícito: si no hay infra (Stripe
  desactivado, NATS caído, etc.) caen al comportamiento V1.

---

## 2. Workstream 1 — Cierre S11 W2 (onboarding enqueueEmail)

### 2.1 Catálogo

`packages/eventbus/src/catalog/notifications.ts`: extender enum
`emailSendRequestedV1.template` para incluir `onboarding_verify`.

### 2.2 Service

`PublicOnboardingService.start`:

- Inyectar `EventbusService`.
- Sustituir el `this.notifications.sendEmail({...})` por
  `this.notifications.enqueueEmail({...})` con `tenantId` =
  sentinel (`00000000-...`) y `dedupKey = onboarding-verify-<emailHash>-<ts>`.
- Si `enqueueEmail` retorna `inlineFallback: true`, log warning + sigue.

### 2.3 Tests

- Actualizar `public-onboarding.service.spec` para mockear
  `enqueueEmail` (en vez de o además de `sendEmail`).

---

## 3. Workstream 2 — Reports export CSV

### 3.1 Endpoint

`GET /reports/:type/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&propertyId=<uuid>`

Tipos V1:
- `daily_revenue` — `(date, room_revenue, fnb, taxes, total)`.
- `occupancy` — `(date, rooms_total, rooms_oco, occ_pct, adr)`.
- `tax_breakdown` — `(date, tax_code, base, amount)`.
- `cash_movements` — `(date, entry, currency, amount, kind)`.

Datos vienen de `night_audit_snapshots` (ya existe).

Roles: `tenant_admin`, `night_auditor`. Idempotente, sin side effects.

### 3.2 Formatter

`apps/api/src/reports/csv-formatter.ts` — utilidad simple sin lib (escape
de comillas + CRLF). Cobertura test al 100%.

### 3.3 UI

`apps/web-fo/src/app/reports/[type]/page.tsx`: botón "Descargar CSV"
que hace `fetch` con header `accept: text/csv` y triggers download
client-side.

### 3.4 Métricas

`reports_csv_export_total{type}` counter.

### 3.5 Pendiente

Reports PDF llega en Sprint 13 — requiere `puppeteer` (ADR a aprobar).

---

## 4. Workstream 3 — Pre-pago full PaymentIntent

### 4.1 Backend

`StripeService.createPaymentIntent(user, reservationId, opts)`:
- Crea PI con `amount`, `currency`, `customer`, `payment_method_types: ['card']`,
  `confirm: false` (el cliente confirma via Elements como en SetupIntent).
- Devuelve `{ clientSecret, publishableKey }`.
- Metadata `{ reservationId, tenantId, kind: 'reservation_charge' }`.
- Idempotency key `pi-charge-<reservationId>` (Stripe nativo).

Webhook handler nuevo en `handleWebhook` para
`payment_intent.succeeded`:
- Localiza reserva por metadata.
- Marca `guaranteeStatus = SECURED`.
- Crea entry en folio `kind: PAYMENT, amount, currency,
  attributes.stripePaymentIntentId`.

### 4.2 IBE

`/h/<slug>/availability` muestra dos opciones por roomType:
- "Tarifa flexible — paga al llegar, requiere tarjeta" (SetupIntent
  existente).
- "Tarifa no reembolsable -10% — paga ahora" (PaymentIntent nuevo).

Selector en `/book`. El form action ramifica:
- `paymentMode === 'setup'` → flujo S8 actual.
- `paymentMode === 'charge'` → llama a nuevo
  `POST /public/ibe/properties/:slug/reservations/:code/payment-intent`
  y la UI muestra Stripe Elements con `confirmPayment` en lugar de
  `confirmSetup`.

### 4.3 DTOs

`CreatePublicReservationDto.paymentMode: 'setup' | 'charge'`
(default `setup` para retro compat).

### 4.4 Cancellation policy

Si la reserva fue creada con `charge`, su `cancellable: false` en
`/manage`. El cancel desde IBE devuelve 409 "No reembolsable según
política".

---

## 5. Workstream 4 — Calendar drag & drop

### 5.1 UI

`apps/web-fo/src/app/calendar/page.tsx`:
- Server-rendered grid (rooms × dates) ya existe (S2).
- Añadir client component `<CalendarDnD>` que monta listeners
  `dragstart/dragover/drop` sobre las celdas.
- Drag de reserva → highlight de drop targets válidos según estado.

### 5.2 Transiciones soportadas V1

- PENDING / CONFIRMED → drop sobre date=today → check-in.
- CHECKED_IN → drop sobre date < today → check-out (early).
- CHECKED_IN → drop sobre habitación distinta → cambio de habitación
  (reusa `POST /reservations/:id/assign-room` ya existe).

Cualquier otra transición → modal "no soportado, usa la ficha".

### 5.3 Conflict resolution

Si la habitación destino está ocupada en alguna fecha del rango →
modal con resumen + opción "Cancelar".

### 5.4 Sin libs

HTML5 Drag and Drop API nativo. Sin `react-dnd`. Stylizado con
Tailwind ya en el proyecto.

---

## 6. Datos y migraciones nuevas

| Migración | Contenido |
|-----------|-----------|
| — | W1 no toca DB. |
| — | W2 no toca DB (lee snapshots existentes). |
| — | W3 reusa columnas Stripe existentes. |
| — | W4 reusa endpoints existentes. |

Sprint 12 es 100% código + UI — cero migraciones.

---

## 7. Orden de ejecución sugerido

1. **W1 Cierre S11 W2** — el más pequeño, libera deuda técnica.
2. **W2 Reports CSV** — mayor leverage para el operador a corto plazo.
3. **W3 Pre-pago PaymentIntent** — útil cuando el primer piloto
   tenga tarifas no reembolsables.
4. **W4 Calendar DnD** — el más visible, el de mayor ROI percibido
   por el operador.

---

## 8. Salida de Sprint 12 (handoff a Sprint 13)

Si los 4 cierran:

- Onboarding totalmente asíncrono (sin acoplamiento a Postmark
  síncrono).
- Operador puede exportar reportes diarios sin pedírselo al equipo.
- IBE soporta dos modelos de pago (flexible + no reembolsable).
- Calendar es una herramienta de FO de verdad (drag check-in en
  lugar de menú).

**Sprint 13 candidates:**

- Reports PDF (con `puppeteer` aprobado).
- Memoria semántica V1.1 (si PO aprueba `openai`).
- 2º channel manager provider (Cloudbeds / RoomCloud).
- Loyalty / promo codes.
- White-label subdominio + CSS custom.
- Auditoría SOC 2 cuando el cliente lo exija.
- Group reservation enhancements (rooming list import CSV).

GTM (PROJECT.md §10 fase 7) sigue en paralelo, fuera de scope Claude.
