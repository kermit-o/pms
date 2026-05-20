# Sprint 11 — Production hardening pre-piloto

> **Versión:** 1.0 — 2026-05-19
> **Branch del plan:** `claude/s11-plan`. Workstreams en `claude/s11-w<N>-<topic>`.
> **Documento padre:** Sprint 10 §8 (handoff) + PROJECT.md §4.4.
> **Predecesores:** Sprint 10 cerrado (Auto-Keycloak, Fix tests,
> Cleanup nocturno, Admin UI).

---

## 0. Norte estratégico

Sprint 10 cerró los gaps V1 del wizard + admin. **Sprint 11 endurece
el sistema para el primer piloto:** lo que tiene que aguantar tráfico
real sin reventar la reputación del dominio, sin perder eventos y sin
"funciona en mi máquina".

Cuatro bloques:

1. **Postmark bounce/complaint webhook** — sin esto, un único bounce
   sin tratar degrada la reputación del dominio y todos los emails
   futuros van a spam. Suppression list + métricas.
2. **NATS consumer de email** — desacopla el envío del request HTTP.
   Si Postmark cae, los emails se reencolan; no devolvemos
   `503 notification_failed` al huésped a mitad del booking.
3. **Stripe webhook hardening** — verificación de firma estricta,
   métricas de eventos por tipo, log de payloads desconocidos.
4. **Grafana dashboards** — los counters/histograms que añadimos en
   S6-S10 no se ven en ningún dashboard. JSON importable en
   `infra/grafana` cubriendo los 4 dominios (IBE, CM, payments,
   notifications).

**Definition of Done de Sprint 11:**

1. **Postmark webhook**: endpoint público `POST /public/notifications/postmark`
   con verificación HMAC + parsing de los 3 tipos relevantes
   (Bounce, SpamComplaint, SubscriptionChange). Cada bounce → entrada
   en `email_suppressions` table; antes de enviar, el service
   consulta la lista.
2. **NATS email consumer**: `NotificationsConsumer` subscribe a
   `email.send_requested` (ya en catálogo S9 W1). Productor cambia
   el envío inline → publish event. Idempotente por `dedupKey`.
3. **Stripe hardening**: verificación de firma estricta con throw
   en mismatch (no log+continue). Métrica
   `stripe_webhook_events_total{type, outcome}`. Logging de eventos
   no manejados.
4. **Dashboards**: 1 dashboard JSON por dominio en `infra/grafana/`
   con paneles para los counters principales y SLO de error rate.

**Lo que NO se entrega:**

- Memoria semántica V1.1 (sigue bloqueada por `openai`).
- 2º channel manager provider.
- Pre-pago full PaymentIntent on-session.
- Multidivisa real.
- White-label subdominio + CSS custom.
- Loyalty / promo codes.
- Auditoría SOC 2.
- Reports export CSV/PDF (operador productivity, Sprint 12 si el
  piloto lo pide).

---

## 1. Workstreams

```
┌──────────────────────────────────────────────────────────────────────┐
│  W1 — Postmark bounce/complaint webhook                              │
│   - apps/api/notifications/postmark-webhook.controller.ts            │
│   - Tabla email_suppressions (event source: bounces + complaints)    │
│   - Pre-check en sendEmail                                           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W2 — NATS consumer de email                                         │
│   - notifications/notifications.consumer.ts                          │
│   - Productores cambian inline → publish event                       │
│   - Idempotencia por dedupKey + outbox table                         │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W3 — Stripe webhook hardening                                       │
│   - Firma estricta (throw mismatch)                                  │
│   - Métricas stripe_webhook_events_total                             │
│   - Log estructurado de eventos unknown                              │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W4 — Grafana dashboards                                             │
│   - infra/grafana/ibe.json                                           │
│   - infra/grafana/channel-manager.json                               │
│   - infra/grafana/payments.json                                      │
│   - infra/grafana/notifications.json                                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios mantenidos:**

- Sin nuevas deps npm.
- Multi-tenant by default.
- Forward-only migrations.
- Toda nueva env var es opcional con fallback seguro (no rompe arranque).

---

## 2. Workstream 1 — Postmark bounce/complaint webhook

### 2.1 Modelo

```sql
CREATE TABLE email_suppressions (
  email     citext PRIMARY KEY,
  reason    text NOT NULL,       -- 'hard_bounce', 'spam_complaint', 'unsubscribe', 'manual'
  detail    text,                -- mensaje del provider (truncado a 500 chars)
  created_at timestamptz NOT NULL DEFAULT now(),
  source     text NOT NULL       -- 'postmark', 'manual', 'imported'
);
```

Suppression list es **global al SaaS** (no por tenant) — si un email
hace bounce duro en hotel A, no le envía notificaciones en hotel B.
Si un huésped lo pide manualmente vía soporte, también global.

### 2.2 Webhook

`POST /public/notifications/postmark`:

- Verificación HMAC con `POSTMARK_WEBHOOK_SECRET` (header
  `x-postmark-signature`, según docs de Postmark).
- Parsea `RecordType`:
  - `Bounce` con `Type = 'HardBounce' | 'Transient' | 'AutoResponder'`.
    Solo `HardBounce` añade suppression.
  - `SpamComplaint` → suppression `spam_complaint`.
  - `SubscriptionChange` con `SuppressSending = true` → suppression
    `unsubscribe`.
  - Cualquier otro → log estructurado, 200 OK.

### 2.3 Pre-check en sendEmail

`NotificationsService.sendEmail` ahora hace `SELECT 1 FROM
email_suppressions WHERE email = $1` antes de invocar Postmark. Si la
email está suprimida, devuelve `{ ok: false, error: 'suppressed' }` y
log `email[skipped] reason=suppressed`.

### 2.4 Métricas

- `email_suppressions_added_total{reason}` (counter)
- `email_send_skipped_suppressed_total` (counter)

### 2.5 Tests

- Webhook unit: HMAC ok/fail, los 3 RecordTypes principales, unknown
  ignorado, idempotencia (insertar dos veces no rompe).
- Service: sendEmail consulta suppression antes de Postmark.

### 2.6 Provisional cleanup manual

`DELETE FROM email_suppressions WHERE email = $1` para reactivar un
huésped. RUNBOOK §28.

---

## 3. Workstream 2 — NATS consumer de email

### 3.1 Productor

Cambiar los 5 sitios que hoy llaman `NotificationsService.sendEmail`
inline a publicar `email.send_requested` en NATS:
- `PublicIbeService.dispatchConfirmation` / `dispatchCancellation`
- `PublicIbeService.resendConfirmation`
- `PublicOnboardingService.start`

El service mantiene método `sendEmail` (lo usa el consumer y los
tests), pero la API externa pasa a ser
`enqueueEmail({ template, to, locale, params, dedupKey })`.

### 3.2 Consumer

`NotificationsConsumer`:

- Subscribe durable a stream NATS (subject `email.send_requested`).
- Por evento: dedup por `dedupKey` (tabla `notification_outbox`),
  llama a `sendEmail`, marca `delivered_at` o `failed_at + error`.
- Retry con back-off exponencial (max 3 intentos en V1 — JetStream
  ack/nak nativo, no custom).
- Métrica `notification_consumer_events_total{template, outcome}`.

### 3.3 Outbox table

```sql
CREATE TABLE notification_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key    text UNIQUE NOT NULL,
  template     text NOT NULL,
  recipient    citext NOT NULL,
  locale       text NOT NULL DEFAULT 'es',
  params       jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending',  -- pending|delivered|failed|suppressed
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  failed_at    timestamptz
);
CREATE INDEX ON notification_outbox (status, created_at);
```

### 3.4 Fallback dry-run consumer

Si NATS no está disponible (entornos dev sin docker), el productor
detecta `EventbusService.healthy = false` y llama a `sendEmail`
directo (mismo comportamiento que V1).

---

## 4. Workstream 3 — Stripe webhook hardening

### 4.1 Firma estricta

Hoy `StripeWebhookController` loguea + continúa si la firma no
verifica. Sprint 11: lanza `ForbiddenException` y métrica.

### 4.2 Métricas

- `stripe_webhook_events_total{type, outcome}` — outcome ∈
  {`handled`, `unknown_type`, `error`, `bad_signature`}.
- `stripe_webhook_event_age_seconds` (histogram, ms entre
  `event.created` y now).

### 4.3 Eventos unknown

Log estructurado `stripe.webhook event=<type> unknown — payload
ignored`. Útil para descubrir tipos nuevos sin perder visibilidad.

### 4.4 Tests

- Verify ok vs bad → 200 vs 403.
- Unknown event type → 200 + counter incremented.

---

## 5. Workstream 4 — Grafana dashboards

### 5.1 Estructura

```
infra/grafana/
  ibe.json
  channel-manager.json
  payments.json
  notifications.json
  README.md
```

Cada JSON es un dashboard exportado importable desde Grafana
"Import via JSON".

### 5.2 Paneles por dashboard

**IBE** (S8 + S9 W4):
- Reservas creadas / hora (`rate(reservation_created_total[1h])`).
- Rate limit hits / 5m por slug.
- Turnstile failures por reason.
- Blocklist hits por slug.

**Channel manager** (S9 W2):
- Sync runs / hora por kind + status.
- Sync duration p50/p95/p99.
- Inbound reservations / hora por source.
- Webhook rejections por reason.

**Payments** (S5+S11 W3):
- Stripe webhook events / hora por type + outcome.
- Webhook event age p95.
- Failed payments.

**Notifications** (S9 W1 + S11 W1 + W2):
- Emails enviados / hora por template.
- Suppressions añadidas / día.
- Consumer outcomes (delivered / failed / suppressed).

### 5.3 README

`infra/grafana/README.md` documenta cómo importar:

```
1. Grafana → Dashboards → Import
2. Upload JSON
3. Select datasource: Prometheus (Aubergine)
```

---

## 6. Datos y migraciones nuevas

| Migración | Contenido |
|-----------|-----------|
| `email_suppressions` | W1 |
| `notification_outbox` | W2 |
| — | W3 no toca DB. |
| — | W4 no toca DB. |

---

## 7. Orden de ejecución sugerido

1. **W1 Postmark webhook** — el más pequeño y de mayor leverage
   (proteger reputación es prioridad #1 cuando empiece tráfico).
2. **W3 Stripe hardening** — pequeño y aislado.
3. **W2 NATS consumer** — más grande, depende de tener W1 listo
   (suppression check sigue funcionando).
4. **W4 Grafana dashboards** — depende de tener todas las métricas
   nuevas (W1, W3) ya emitiendo en prod.

---

## 8. Salida de Sprint 11 (handoff a Sprint 12)

Si los 4 cierran:

- El piloto puede arrancar con tráfico real sin riesgo de quemar el
  dominio.
- Reservas no fallan por caída transitoria de Postmark.
- Stripe webhooks se monitorean activamente.
- Operaciones tienen visibilidad de los 4 dominios en Grafana.

**Sprint 12 candidates:**

- Reports export CSV/PDF (operator productivity).
- Memoria semántica V1.1 (si PO aprueba `openai`).
- 2º channel manager provider (Cloudbeds/RoomCloud).
- Pre-pago full PaymentIntent on-session.
- Loyalty / promo codes (si piloto lo pide).
- White-label subdominio.
- Calendar drag & drop check-in.
- Group reservation enhancements.
