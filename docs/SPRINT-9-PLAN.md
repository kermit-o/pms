# Sprint 9 — Email real, Channel Manager, Onboarding, Anti-abuso

> **Versión:** 1.0 — 2026-05-17
> **Branch de desarrollo:** workstreams en `claude/s9-w<N>-<topic>`.
> **Documento padre:** Sprint 8 §8 (handoff) + PROJECT.md §4.4.
> **Predecesores:** Sprint 8 IBE V1 cerrado en código (W1-W4).

---

## 0. Norte estratégico

Sprint 8 cerró el IBE V1: el huésped puede buscar, reservar, asegurar
tarjeta y gestionar. Lo que falta para que **un hotel real lo pueda
encender en producción sin operador Aubergine** es:

1. **Email real** — sin email de confirmación, el IBE no es defendible.
2. **Channel Manager** — para no canibalizar tráfico OTA mientras
   crecemos el directo.
3. **Onboarding wizard** — un hotel debe poder registrarse y
   configurarse sin nuestra intervención.
4. **Anti-abuso** — captcha + hardening para cuando aparezca tráfico
   adverso real.

Sprint 9 entrega estos 4 bloques. Memoria semántica V1.1 (pgvector +
embeddings reales) sigue bloqueada hasta que el PO apruebe la dep
`openai` — no entra en S9.

**Definition of Done de Sprint 9:**

1. **Email service real**: módulo `notifications` con provider
   conectable (Postmark V1, SMTP genérico V1.1). Eventos consumidos:
   `reservation.created`, `reservation.cancelled`, `reservation.checked_in`,
   `confirmation_resend_requested` (catálogo nuevo). Plantillas HTML +
   texto, ES/EN, marca del hotel. Métricas Prometheus.
2. **Channel Manager (un proveedor)**: integración con un channel
   manager open-API (preferencia: SiteMinder Hotel API o
   RoomCloud). Push de disponibilidad + tarifas + restricciones desde
   Aubergine al CM. Pull de reservas OTA → Aubergine. ARI sync nightly
   + en cambio. Sin SDK externa (REST directo).
3. **Onboarding wizard self-service**: páginas de "crea tu hotel" sin
   auth de cliente Aubergine — el hotel se registra solo. Crea tenant
   + property + admin user + Keycloak realm bootstrap. Documentación
   guiada.
4. **Anti-abuso**: Cloudflare Turnstile (gratis, sin dep npm) en
   `/book` y `/manage` del IBE. Sliding-window rate limit en API por
   tenant + IP+. Bloqueo manual de IPs en `properties.attributes` para
   emergencia.

**Lo que NO se entrega:**

- Múltiples channel managers a la vez (Sprint 10 si el piloto demanda).
- Loyalty / promo codes / corporate booking (V2).
- Pago multidivisa real (V2 — display ya funciona).
- Memoria semántica V1.1 (bloqueado por dep `openai`).
- Onboarding white-label completo (subdominio + custom CSS por hotel).
- Email transaccional para back-office (FO/HSK) — V1 solo IBE-facing.

---

## 1. Workstreams

```
┌──────────────────────────────────────────────────────────────────────┐
│  W1 — Email real                                                     │
│   - apps/api/src/notifications + provider Postmark + plantillas      │
│   - Catálogo de eventos en packages/eventbus                         │
│   - Consumer NATS que mapea evento -> plantilla -> envío             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W2 — Channel Manager (push avail+rates / pull OTA reservations)    │
│   - apps/api/src/channel-manager                                     │
│   - Provider abstracto + impl SiteMinder (REST)                      │
│   - Job nightly + on-change push                                     │
│   - Webhook receiver para OTA bookings                               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W3 — Onboarding wizard self-service                                 │
│   - apps/web-fo o app dedicada apps/web-onboarding                   │
│   - POST público /onboarding con verificación email                  │
│   - Crea tenant + property + admin + Keycloak realm seed             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W4 — Anti-abuso (Turnstile + hardening)                             │
│   - apps/web-ibe: Turnstile script en /book y /manage                │
│   - apps/api/public-ibe: verificación de token Turnstile             │
│   - IP blocklist via properties.attributes.blockedIps                │
│   - Métricas Prometheus de rate-limit hits                           │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios mantenidos:**

- ADR-020: cancelaciones con penalty siguen requiriendo confirm
  explícita (W4 no relaja eso).
- Multi-tenant by default: emails, channel sync, onboarding — todo
  scoped por tenantId.
- Sin SDK externa cuando un fetch REST basta.
- Nuevas deps requieren ADR + aprobación PO (CLAUDE.md §8) — V1 elige
  el provider con menor sobrecoste (Postmark = 1 dep, REST simple;
  Cloudflare Turnstile = cero deps).

---

## 2. Workstream 1 — Email real

### 2.1 Catálogo de eventos en eventbus

Añadir a `packages/eventbus`:
- `email.send_requested v1` con `{ template, recipient, params }`.
- `reservation.confirmation_resend_requested v1` (ya logueado en S8
  W4, ahora con consumer real).
- Re-uso de `reservation.created v1` para confirmación inicial.
- `reservation.cancelled v1` para email de cancelación.

### 2.2 Notifications module

`apps/api/src/notifications`:
- `NotificationsService` con método `sendEmail({ template, to, params,
  locale })`.
- Provider interface (`PostmarkProvider` V1, `SmtpProvider` V1.1
  cuando alguien lo pida).
- Plantillas Handlebars-like con `params` interpolados — sin lib
  externa, regex `{{ key }}`. ES + EN.
- 4 plantillas V1:
  - `reservation_confirmation` (huésped)
  - `reservation_cancelled` (huésped)
  - `front_desk_new_reservation` (operador)
  - `hsk_pairing_invite` (futuro, placeholder)

### 2.3 Consumer NATS

`NotificationsConsumer` subscribe a la stream del eventbus, mapea
evento → template + recipient. Idempotente por `eventId`.

### 2.4 Configuración

`POSTMARK_SERVER_TOKEN` (secret). Si no está, modo dry-run (loguea +
no envía). Plantilla por hotel via `Property.attributes.email.brand`
(opcional).

### 2.5 Tests

- Unit del Service (mock provider).
- Plantilla render (snapshot tests).
- Consumer end-to-end con un mock NATS.

---

## 3. Workstream 2 — Channel Manager

### 3.1 Modelo

```sql
ALTER TABLE properties ADD COLUMN channel_manager_provider TEXT;
ALTER TABLE properties ADD COLUMN channel_manager_property_id TEXT;
ALTER TABLE properties ADD COLUMN channel_manager_credentials_ref TEXT;
-- credentials_ref apunta a un secret en Fly Secrets (no DB).
```

Nueva tabla `channel_sync_runs(id, tenant_id, property_id, kind, status,
started_at, completed_at, error, totals)`.

### 3.2 Provider abstracto

`apps/api/src/channel-manager`:
- `ChannelManagerProvider` interface: `pushAvailability`,
  `pushRates`, `pullReservations`.
- `SiteMinderProvider` V1 con REST. (Otros providers: Cloudbeds
  Channel, RoomCloud — Sprint 10).

### 3.3 Job nightly + on-change

- Cron en cron-jobs.ts o NATS scheduled: tras NA `CLOSE_DAY`, push
  availability + rates de los próximos 365 días.
- On-change: cuando se crea/cancela una reserva (`reservation.created`,
  `reservation.cancelled`), push delta de la habitación + fechas
  afectadas.

### 3.4 Pull OTA → Aubergine

Webhook público `/public/cm/:slug/webhook` que recibe bookings de la
OTA via CM. Validación firma HMAC con el secret del CM. Crea
Reservation con `source = BOOKING_COM / EXPEDIA / OTHER_OTA` según
mapping del provider.

---

## 4. Workstream 3 — Onboarding wizard self-service

### 4.1 Modelo

Sin migración nueva si Tenant + Property + User actuales bastan. Sí
añadir `onboarding_status TEXT` en `tenants` para gating del wizard.

### 4.2 Páginas (decidir: web-fo o app dedicada)

Decisión V1: dentro de `apps/web-fo` con prefijo `/onboarding` y
`@Public()` en los endpoints API correspondientes. Crear una app
dedicada `web-onboarding` es scope deviation para V1.

Páginas:
- `/onboarding` — landing + email del solicitante.
- `/onboarding/verify?token=` — verificación email.
- `/onboarding/setup/:tenantId?token=` — datos hotel: nombre, ciudad,
  habitaciones (cantidad inicial — los detalles vienen luego),
  divisa, idioma.
- `/onboarding/done` — credenciales del primer admin + link al
  back-office.

### 4.3 API endpoints

`apps/api/src/public-onboarding`:
- `POST /public/onboarding/start` body `{ email }` → manda email con
  token y crea registro `tenants(status='TRIAL', onboarding_status='EMAIL_VERIFY')`.
- `POST /public/onboarding/verify` body `{ token }` → marca email
  verified, devuelve tenantId temporal.
- `POST /public/onboarding/setup` body `{ tenantId, token, hotel: {...} }` →
  crea Property + RoomTypes default + RatePlan BAR + admin User +
  Keycloak realm seed (script-driven, ver §4.4).

### 4.4 Keycloak realm seed

Reusar `scripts/keycloak-bootstrap.ts` adaptado a entrada parametrizada:
- crea realm `pms-{slug}`,
- crea client `pms-api`, `pms-fo`, `pms-ibe` con redirect URIs default,
- crea user admin con password temporal,
- devuelve credenciales para el email final.

Si Keycloak admin API no es accesible desde el API (firewall), V1 deja
el seed manual y el wizard solo provisiona DB. Documentar en RUNBOOK.

---

## 5. Workstream 4 — Anti-abuso

### 5.1 Turnstile en web-ibe

Cloudflare Turnstile widget script (gratis, sin dep npm):
- `/book` y `/manage`: token oculto en el form.
- Server action incluye `cf-turnstile-response` en el POST a la API.
- API verifica token con
  `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`.

Env vars:
- `TURNSTILE_SITE_KEY` (público, en web-ibe)
- `TURNSTILE_SECRET_KEY` (privado, en api)

Si las env vars no están, V1 skip — útil en dev y para hoteles que no
ven abuso real.

### 5.2 Rate limit por tenant

Ampliar `RateLimitGuard` para considerar `slug` + `ip` en lugar de
solo `route + ip`. Las decoraciones `@RateLimit` no cambian — el guard
extrae slug de path params si existe.

### 5.3 IP blocklist por hotel

`Property.attributes.blockedIps: string[]`. El guard verifica antes de
contar rate-limit y devuelve 403 si match.

### 5.4 Métricas Prometheus

- `public_ibe_rate_limit_hits_total{slug, route}`
- `public_ibe_turnstile_failures_total{slug}`

Alerta si `rate_limit_hits` > 100 en 5min (abuse activo).

---

## 6. Datos y migraciones nuevas

| Migración | Contenido |
|-----------|-----------|
| `properties.channel_manager_*` | W2 |
| `channel_sync_runs` | W2 |
| `tenants.onboarding_status` | W3 (mínimo) |

---

## 7. Orden de ejecución sugerido

1. **W1 Email real** — desbloquea UX completa del IBE.
2. **W4 Anti-abuso** — defensa antes de exponer el IBE a tráfico
   real.
3. **W3 Onboarding** — habilita crecimiento sin nosotros.
4. **W2 Channel Manager** — el más grande; se beneficia de tener W1
   (notifica al hotel cuando OTA reserva) y W3 (configurable desde el
   wizard).

---

## 8. Salida de Sprint 9 (handoff a Sprint 10)

Si los 4 cierran:

- Aubergine es operable por un hotel independiente, sin operador
  nuestro, con venta directa + canales OTA.
- Stripe Fase 2 cobra no-show off-session automáticamente.
- Email confirma todas las acciones del huésped.

**Sprint 10 arrancará con:**

- Memoria semántica V1.1 (si PO aprueba `openai`).
- 2º channel manager provider.
- Pre-pago full PaymentIntent on-session.
- Multidivisa real.
- White-label subdominio + CSS custom.
- Loyalty / promo codes.
- Auditoría SOC 2 cuando el cliente lo exija.

GTM (PROJECT.md §10 fase 7) sigue en paralelo, fuera de scope Claude.
