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

## 2026-05-19 · [FEAT] · Sprint 10 W4 — Back-office admin de Property (cierre del sprint)

**Scope:** `apps/api/properties`, `apps/web-fo/properties`,
`RUNBOOK.md`
**Branch:** `claude/s10-w4-admin-ui-v2`
**Refs:** este commit

**Qué cambió.**

- Nuevo `PropertiesService` + extensión de `PropertiesController` con
  cuatro endpoints:
  - `GET /properties/:id/settings` — devuelve los tres bloques (rol
    `tenant_admin/front_desk/night_auditor`).
  - `PUT /properties/:id/publish` — toggle IBE con
    auto-generación `publicSlug = hotel-<hex6>` cuando falta y
    detección de colisiones (`409 public_slug_taken`).
  - `PUT /properties/:id/channel-manager` — `provider` (V1
    `'siteminder'`), `channelManagerPropertyId`, `credentialsRef`.
  - `PUT /properties/:id/blocked-ips` — lista completa
    (deduplicada, max 500, validación IPv4/IPv6 via Zod).
- Las mutaciones requieren rol `tenant_admin`. Lecturas accesibles a
  operadores normales.
- Cada PUT emite `property.updated v1` con `changes: {...}`.
- Nueva página `apps/web-fo/src/app/properties/[id]/settings/page.tsx`
  con tres secciones (anclas `#ibe`, `#cm`, `#ips`) y server actions.
- Link discreto en `/dashboard` ("Configurar hotel") cuando hay
  `propertyId` activo.
- `apps/web-fo/src/lib/api.ts` extendido con 4 helpers nuevos.
- RUNBOOK §27 con endpoints, validaciones, eventos y rol Keycloak.

**Por qué.**

Sprint 10 §5. Hasta ahora la configuración de IBE/CM/blocked IPs
estaba solo en SQL — el hotel no podía operar sin nuestro equipo
tocando la DB. W4 cierra ese gap para que el piloto sea
self-service: un `tenant_admin` configura los tres bloques desde UI.

**Archivos clave.**

- `apps/api/src/properties/properties.{service,controller,dto,module}.ts`
- `apps/api/src/properties/properties.service.spec.ts`
- `apps/web-fo/src/app/properties/[id]/settings/page.tsx`
- `apps/web-fo/src/app/dashboard/page.tsx`
- `apps/web-fo/src/lib/api.ts`
- `RUNBOOK.md` §27

**Tests.**

- `properties.service.spec` × 11 (getSettings 404 + parsing,
  setPublish auto-slug / explicit / collision / unpublish-keeps-slug,
  setChannelManager update / clear, setBlockedIps merge + event).
- `pnpm --filter @pms/api test` → **262/262 passed (43 suites)**.
  Cherry-pick S10 W2 incluido (Decimal mock + business-day fechas).
- Typecheck + lint verdes en api y web-fo.

**Sigue pendiente.**

- **Sprint 10 cerrado en código.** Merge a main + redeploy de los 4
  workstreams (W1 Auto-Keycloak, W2 Fix tests, W3 Cleanup nightly,
  W4 Admin UI) pendiente del PO.
- Rama W4 depende de S9 W2 + S9 W4 (incluyendo cherry-pick). Estrategia
  de merge: orden Sprint 9 W1/W2/W3/W4 → S10 W2 → W1 → W3 → W4.
- Sprint 11 candidates (per SPRINT-10-PLAN §8): memoria semántica
  V1.1, 2º CM provider, pre-pago full PaymentIntent, multidivisa,
  white-label, loyalty, SOC 2.

---

## 2026-05-19 · [INTEGRATION] · Sprint 9 W2 — Channel Manager (SiteMinder skeleton + webhook OTA)

**Scope:** `apps/api/channel-manager`, `apps/api/reservations`,
`apps/api/public-ibe`, `apps/api/night-audit`, `packages/db`,
`packages/eventbus`, `RUNBOOK.md`
**Branch:** `claude/s9-w2-channel-manager`
**Refs:** este commit

**Qué cambió.**

- Nuevo módulo `@Global() ChannelManagerModule` con tres flujos:
  - **Push delta on-change** — invocado inline desde
    `ReservationsService.create/cancel` y `PublicIbeService.create/cancel`.
    Errores no propagan: si el CM falla, la reserva igualmente se crea.
  - **Push nightly** — invocado tras `NightAuditService.run_completed`,
    365 días de availability + rates.
  - **Inbound webhook** — `POST /public/cm/:slug/webhook`, HMAC verificado,
    idempotente por `externalRef`. Mapea `channelCode` →
    `ReservationSource ∈ {BOOKING_COM, EXPEDIA, OTHER_OTA}`.
- `ChannelManagerProvider` interface + implementación `SiteMinderProvider`
  (fetch directo, sin SDK). Endpoints REST documentados; el JSON shape de
  webhook está modelado contra docs públicas — confirmación contra cuenta
  real del cliente queda como follow-up del primer piloto con CM.
- Migración `20260614000000_channel_manager`:
  - `properties.channel_manager_provider`, `channel_manager_property_id`,
    `channel_manager_credentials_ref` (text, nullable).
  - Tabla `channel_sync_runs` con enums `ChannelSyncKind` (4 valores) y
    `ChannelSyncStatus` (4 valores). RLS por tenant.
- Catálogo eventbus: `channel.sync_completed v1` y
  `channel.inbound_reservation_received v1`.
- Métricas Prometheus `channel_manager_{sync_total, sync_duration_ms,
  inbound_total, webhook_rejections_total}`. Sin label por property
  (consulta `channel_sync_runs` para detalle).
- Env nuevas: `CM_SITEMINDER_API_BASE`, `CM_SITEMINDER_HMAC_SECRET`.
  Sin ellas → no-op silencioso, el PMS sigue funcionando.
- RUNBOOK §24 con configuración SQL por hotel, shape del webhook,
  consulta de runs, y cómo apagar el canal sin redeploy.

**Por qué.**

Sprint 9 plan §3. Sin CM, el hotel canibaliza el directo cada vez que
sube precios o disponibilidad por separado en cada OTA. El plan pedía
un proveedor (SiteMinder) — el módulo está diseñado como provider
abstracto para que añadir Cloudbeds / RoomCloud en Sprint 10 sea
trivial. El push es on-change + nightly (no realtime puro) porque
SiteMinder rate-limita a unos cientos de calls/min por hotel.

**Archivos clave.**

- `apps/api/src/channel-manager/{channel-manager.service,.controller,.metrics,types,index}.ts`
- `apps/api/src/channel-manager/providers/siteminder.provider.ts`
- `apps/api/src/reservations/reservations.service.ts` (wire pushDelta)
- `apps/api/src/public-ibe/public-ibe.service.ts` (wire pushDelta)
- `apps/api/src/night-audit/night-audit.service.ts` (wire nightlyPush)
- `apps/api/src/app.module.ts`, `config/env.schema.ts`
- `packages/db/prisma/schema.prisma` + migration
  `20260614000000_channel_manager/migration.sql`
- `packages/db/src/index.ts` (export `ChannelSyncKind`/`Status`/`Run`)
- `packages/eventbus/src/catalog/channel-manager.ts` + index
- `RUNBOOK.md` §24

**Tests.**

- `siteminder.provider.spec.ts` × 10 (HMAC, channel mapping, push HTTP).
- `channel-manager.service.spec.ts` × 8 (inbound idempotency, bad sig,
  unknown property, no provider, no room type; pushDelta no-op + skipped).
- 60 tests verdes en suites tocados (channel-manager + public-ibe +
  night-audit).
- 4 fallos preexistentes (Decimal mock en reservations.create,
  fechas hardcoded en business-day) **no introducidos** en este
  workstream — son los mismos arrastrados desde sprint 8/9.
- `pnpm --filter @pms/api typecheck`, `lint` verdes.
- `pnpm --filter @pms/db build`, `@pms/eventbus build` verdes.

**Sigue pendiente.**

- Confirmar shape exacto del webhook contra una cuenta SiteMinder
  real cuando el primer piloto se firme.
- 2º provider (Cloudbeds Channel o RoomCloud) en Sprint 10.
- Migración a `@nestjs/schedule` para el push nightly cuando aparezca
  multi-property por tenant — V1 invoca inline desde NA.
- 4 fallos preexistentes de tests siguen pendientes de fix (no
  bloquean este workstream).

---

## 2026-05-17 · [FEAT] · Sprint 9 W1 — Email transaccional real

**Scope:** `packages/eventbus`, `apps/api/notifications`,
`apps/api/public-ibe`, `RUNBOOK.md`
**Branch:** `claude/s9-w1-email`
**Refs:** este commit

**Qué cambió.**

- **Eventbus.** Catálogo `notifications.ts` con 2 eventos nuevos:
  `email.send_requested v1` y `reservation.confirmation_resend_requested v1`.
  Registrados en `catalog/index.ts` + exports.
- **Módulo `notifications`** (Global):
  - `NotificationsService.sendEmail({ template, to, params, locale })`.
  - Provider Postmark via fetch REST (sin SDK — cero deps nuevas).
  - Fallback `DryRunProvider` si no hay `POSTMARK_SERVER_TOKEN` o
    `NOTIFICATIONS_FROM`. Loguea estructurado.
  - 3 plantillas V1 (`reservation_confirmation`, `reservation_cancelled`,
    `front_desk_new_reservation`), ES + EN para las dos primeras.
  - Render con interpolación `{{ key }}` regex puro, soporta dotted
    paths (`brand.name`). Wrap HTML responsive mínimo (table layout,
    inline styles).
  - Branding por hotel via `params.brand.{name, primaryColor}`.
- **PublicIbeService** dispatch inline tras
  `createReservation` (confirmación al huésped), `cancelReservation`
  (email cancelación) y `resendConfirmation` (re-envía la
  confirmación + publica `reservation.confirmation_resend_requested`).
- **Env nuevas:** `POSTMARK_SERVER_TOKEN`, `NOTIFICATIONS_FROM`,
  `NOTIFICATIONS_REPLY_TO`, `IBE_PUBLIC_URL`, `BACKOFFICE_PUBLIC_URL`.
- **Tests.** `notifications.service.spec.ts` (5: dry_run, live ok,
  Postmark error, template interpolation, locale fallback ES);
  spec de `public-ibe.service` actualizado al nuevo constructor.
  16/16 verde.
- **RUNBOOK §21** documenta provider, env, plantillas, idempotencia,
  branding y cómo apagar.

**Por qué.**

Cierra el gap más urgente del IBE V1 (Sprint 8): el huésped no
recibía nada. Decisión clave: **sin nuevas deps npm** — la API REST
de Postmark se llama con fetch. Mantiene el espíritu CLAUDE.md §8
(añadir dep requiere ADR). Mismo patrón que Turnstile y Channel
Manager planeados para W4/W2.

**Decisión registrada.** El consumer NATS dedicado para emails
(desacoplado del productor) se difiere a Sprint 10. V1 hace dispatch
inline tras el `events.publish`. Los productores quedan acoplados a
`NotificationsService` por ahora — refactor a consumer NATS es no-op
para los productores (`events.publish` ya queda con el evento
`email.send_requested`).

**Archivos clave.**

- `packages/eventbus/src/catalog/notifications.ts`
- `packages/eventbus/src/catalog/index.ts` (registro + exports)
- `apps/api/src/notifications/notifications.service.ts` + spec
- `apps/api/src/notifications/templates/index.ts`
- `apps/api/src/notifications/index.ts` (`NotificationsModule` global)
- `apps/api/src/app.module.ts` (registro)
- `apps/api/src/config/env.schema.ts` (5 env nuevas)
- `apps/api/src/public-ibe/public-ibe.service.ts` (dispatch + spec)
- `RUNBOOK.md` §21

**Sigue pendiente** (W2/W3/W4 + follow-ups):

- Consumer NATS dedicado para `email.send_requested` (S10).
- Plantilla `front_desk_new_reservation` activa (hoy compila pero
  ningún hook la dispara — pendiente configurar email del hotel).
- W2 Channel Manager.
- W3 Onboarding wizard.
- W4 Anti-abuso (Turnstile, IP blocklist).

---

## 2026-05-17 · [DOCS] · SPRINT-9-PLAN.md — Email, Channel Manager, Onboarding, Anti-abuso

**Scope:** docs
**Branch:** `claude/sprint-9-plan`
**Refs:** este commit

**Qué cambió.**

- Nuevo `docs/SPRINT-9-PLAN.md` con 4 workstreams enfocados a "encender
  un hotel real sin operador Aubergine":
  - **W1 Email real**: módulo notifications, provider Postmark V1
    (REST), plantillas ES/EN (4 V1), consumer NATS idempotente,
    catálogo de eventos nuevo (`email.send_requested`,
    `reservation.confirmation_resend_requested`).
  - **W2 Channel Manager**: provider abstracto + SiteMinder V1 (REST,
    sin SDK), push avail+rates nightly + on-change, pull OTA bookings
    via webhook con HMAC. Nueva tabla `channel_sync_runs` y columnas
    en `properties`.
  - **W3 Onboarding wizard self-service**: `/onboarding` en web-fo
    (no app dedicada — scope discipline), endpoints públicos
    `start/verify/setup`, Keycloak realm seed adaptado de
    `scripts/keycloak-bootstrap.ts`. `tenants.onboarding_status`.
  - **W4 Anti-abuso**: Cloudflare Turnstile (cero deps nuevas) en
    `/book` y `/manage`, verificación server-side en API, IP blocklist
    por property en `attributes.blockedIps`, ampliar RateLimitGuard
    para slug+ip.
- Orden propuesto: W1 → W4 → W3 → W2.
- Decisión recogida: memoria semántica V1.1 (`openai` dep) sigue
  bloqueada hasta aprobación PO — no entra S9, se difiere a S10.

**Por qué.**

Cierra el handoff §8 de Sprint 8. Tras S9, un hotel independiente
puede operar Aubergine end-to-end con venta directa + OTAs sin
nuestra intervención. Las nuevas deps están justificadas explícitamente
en el plan: Postmark (1 dep, REST simple) para emails; cero deps para
Turnstile y Channel Manager (REST nativo).

**Archivos clave.**

- `docs/SPRINT-9-PLAN.md`

---

## 2026-05-17 · [FEAT] · Sprint 8 W4 — Manage my reservation

**Scope:** `apps/api/public-ibe`, `apps/web-ibe`, `RUNBOOK.md`,
`docs/SPRINT-8-PLAN.md`
**Branch:** `claude/s8-w4-manage`
**Refs:** este commit

**Qué cambió.**

- **API.**
  - `PublicIbeService.resendConfirmation(slug, code, lastName)`:
    verifica `(code, lastName)`, retorna `{ queued: true, email }`. V1
    loguea estructurado (`reservationId code email tenant cid`) — el
    consumer real de email vive en Sprint 9.
  - Endpoint `POST /public/ibe/properties/:slug/reservations/:code/resend-confirmation`
    (rate 3/hora — abuse defensivo).
  - DTO `ResendConfirmationDto { lastName }`.
- **Web-ibe `/h/<slug>/manage`** (server component + server actions):
  - Sin code+lastName en query → form lookup.
  - Con code+lastName → llamada a `getReservation` y vista detallada
    con estado, fechas, tipo, total, política de cancelación.
  - **Reenviar email** (server action → `resend-confirmation`).
  - **Cancelar** (cuando la reserva es cancelable): checkbox "acepto
    penalización", botón rojo. Si la API responde 409 pidiendo
    `acceptPenalty=true`, muestra banner ámbar y el huésped reintenta.
  - Banners: cancelled (con monto), cancel_needs_accept, cancel_fail,
    resent, resend_fail, lookup_fail. Estado coloreado por status.
- **Helpers web-ibe**: `cancelReservation` + `resendConfirmation`.
- **RUNBOOK §20.9** con flujo, endpoint, rate-limit, follow-ups.

**Por qué.**

Cierra el ciclo huésped del IBE. Lookup débil (code + apellido) es
estándar en hotelería — el rate-limit es el cinturón. Cancelación con
política aplicada server-side y double-opt-in (`acceptPenalty=true`)
respeta ADR-020 (nada se ejecuta sin confirmación del usuario).

**Build:** First Load JS = 109 kB para `/manage` (mismo bundle del
resto del IBE).

**Decisión registrada (deviación leve del plan).**

El plan §6 mencionaba emitir un evento NATS `email.send` v1 para el
reenvío. Como el catálogo de eventos de `eventbus` está estrictamente
tipado y añadir un evento nuevo requiere tocar `packages/eventbus`
(scope deviation cross-paquete), V1 sólo loguea. El log estructurado
cubre auditoría hasta que S9 introduzca el catálogo de email events
con su consumer.

**Archivos clave.**

- `apps/api/src/public-ibe/public-ibe.service.ts` (resendConfirmation +
  fix de findPublishedProperty perdido en edit anterior)
- `apps/api/src/public-ibe/public-ibe.controller.ts` (endpoint)
- `apps/api/src/public-ibe/public-ibe.dto.ts` (ResendConfirmationDto)
- `apps/web-ibe/src/app/h/[slug]/manage/page.tsx`
- `apps/web-ibe/src/lib/api.ts` (cancelReservation, resendConfirmation)
- `RUNBOOK.md` §20.9
- `docs/SPRINT-8-PLAN.md` (estado actualizado)

**Sprint 8 IBE V1 completo (W1+W2+W3+W4).** Ninguna rama mergeada a
`main` — pendiente validación PO.

**Sigue pendiente** (handoff a Sprint 9 — sección §8 del plan):

- Channel Manager (push avail/rates a Booking.com / Expedia).
- Email service real (Postmark / SendGrid) con plantillas
  multidioma. V1 sólo emite log; W4 ya tiene el endpoint listo.
- Captcha (Turnstile) en `/book` y `/manage` si hay abuso real.
- Onboarding wizard self-service.
- Pre-pago full (PaymentIntent on-session).
- Custom domain por property.
- Memoria semántica V1.1 (pgvector + openai).

---

## 2026-05-17 · [FEAT] · Sprint 8 W3 — Booking flow + Stripe SetupIntent

**Scope:** `apps/api/public-ibe`, `apps/web-ibe`, `RUNBOOK.md`
**Branch:** `claude/s8-w3-booking`
**Refs:** este commit

**Qué cambió.**

- **API.**
  - `PublicIbeService.createSetupIntent(slug, code, lastName)` y
    `confirmSetupIntent(slug, code, lastName)`. Verifican `(code,
    lastName)`, construyen `AuthUser` sentinel con role vacío y
    delegan a `StripeService.createSetupIntent` /
    `confirmSetupIntent` del back-office. Cero duplicación de lógica
    Stripe.
  - 2 endpoints públicos nuevos:
    - `POST /public/ibe/properties/:slug/reservations/:code/setup-intent`
      (rate 10/min).
    - `POST /public/ibe/properties/:slug/reservations/:code/confirm-setup-intent`
      (rate 10/min).
  - DTO `PublicSetupIntentDto { lastName }`.
  - `PublicIbeModule` ahora importa `PaymentsModule` para resolver
    `StripeService`.
- **Web-ibe.**
  - Deps añadidas: `@stripe/stripe-js` + `@stripe/react-stripe-js`
    (ya aprobadas en monorepo via web-fo, no ADR nuevo).
  - Página `/h/<slug>/book` (server component) con form server
    action: nombre, apellido, email, phone, nacionalidad,
    `gdprConsent` obligatorio, `marketingConsent` opcional, comments.
    Validación inline + redirect con `?error=` para mostrar mensajes.
  - Página `/h/<slug>/book/<code>?lastName=` con confirmación,
    schema.org `LodgingReservation`, KPIs (llegada/salida/tipo/total),
    política de cancelación, y botón opcional "Capturar tarjeta".
  - Componente cliente `stripe-card-capture.tsx`: modal con Stripe
    Elements + flow idéntico a web-fo adaptado para auth pública
    (code+lastName en query).
  - Proxies `/api/setup-intent` y `/api/confirm-setup-intent` en
    web-ibe.
- **Tests.** +2 en `public-ibe.service.spec.ts` (createSetupIntent
  delega con sentinel; rechaza si code+lastName mismatch). 11/11
  verde en `src/public-ibe`.
- **RUNBOOK §20.8** documenta rutas, endpoints, flujo end-to-end,
  privacidad PCI.

**Por qué.**

Cierra el camino crítico del IBE: el huésped puede reservar y, si
quiere, asegurar con tarjeta sin que el operador del hotel intervenga.
PCI SAQ A respetado — el PAN solo va a Stripe Elements en el browser.
Reutilizamos toda la lógica Stripe del back-office con un sentinel
user — cero duplicación, cero divergencia entre paths.

**Performance build:** First Load JS = 109 kB en general, 116 kB en
la página de confirmación con Elements (objetivo <200 kB del plan
cumplido).

**Archivos clave.**

- `apps/api/src/public-ibe/public-ibe.service.ts`
  (createSetupIntent + confirmSetupIntent + resolvePublicReservation)
- `apps/api/src/public-ibe/public-ibe.controller.ts` (2 endpoints)
- `apps/api/src/public-ibe/public-ibe.dto.ts` (PublicSetupIntentDto)
- `apps/api/src/public-ibe/index.ts` (PaymentsModule importado)
- `apps/web-ibe/package.json` (Stripe deps)
- `apps/web-ibe/src/app/h/[slug]/book/page.tsx` (form + server action)
- `apps/web-ibe/src/app/h/[slug]/book/[code]/page.tsx` (confirmación)
- `apps/web-ibe/src/app/h/[slug]/book/[code]/stripe-card-capture.tsx`
- `apps/web-ibe/src/app/api/setup-intent/route.ts`
- `apps/web-ibe/src/app/api/confirm-setup-intent/route.ts`
- `apps/web-ibe/src/lib/api.ts` (createReservation, publicSetupIntent,
  publicConfirmSetupIntent + tipos)
- `RUNBOOK.md` §20.8

**Sigue pendiente** (W4 + follow-ups):

- **W4 Manage**: `/h/<slug>/manage` con lookup por code+lastName,
  vista + cancelación con política.
- Email real de confirmación (S9 — V1 sigue solo emitiendo evento
  `reservation.created`).
- Captcha en `/book` si aparece abuso real en piloto.
- Pre-pago full (PaymentIntent on-session) cuando el hotel lo exija
  — V1 solo guarantee.
- Mensaje de error más rico cuando Stripe pide SCA en setup.

---

## 2026-05-17 · [FEAT] · Sprint 8 W2 — App pública `web-ibe`

**Scope:** `apps/web-ibe` (nuevo), `RUNBOOK.md`
**Branch:** `claude/s8-w2-web-ibe`
**Refs:** este commit

**Qué cambió.**

- Nueva app `apps/web-ibe`: Next.js 15 standalone, sin auth, mobile-first.
- **Rutas V1:**
  - `/` — landing con buscador de hotel por slug.
  - `/h?slug=…` — redirect a `/h/<slug>`.
  - `/h/<slug>` — home del hotel + formulario de búsqueda (fechas, PAX,
    selector ES/EN).
  - `/h/<slug>/availability?arrival&departure&adults&children&lang` —
    listado de tarifas con CTA "Reservar" (a W3 cuando esté).
  - `/manage` + `/h/<slug>/manage` — placeholders W4.
- **i18n.** `lib/i18n.ts` con diccionario ES/EN sin libs externas.
  Resuelve locale por `?lang=` con default `es`. Migrar a `next-intl`
  cuando el catálogo crezca.
- **SEO.** Schema.org `Hotel` JSON-LD inyectado en la home del hotel.
- **API client** `lib/api.ts` sin auth — `getProperty`,
  `searchAvailability`, `getReservation`.
- **Performance.** Build Next 15: First Load JS = 109 kB (< 200 kB del
  plan). Páginas con `dynamic = 'force-dynamic'` porque la
  disponibilidad varía por fecha.
- **Infra.** `Dockerfile` multi-stage standalone, `fly.toml` apuntando
  a `pms-api.internal:3000`, port 3003. `next.config.mjs` con `output:
  'standalone'` y `outputFileTracingRoot` para el monorepo.
- **RUNBOOK §20.7** documenta rutas, i18n, SEO, performance y deploy.

**Por qué.**

Sprint 8 W2 — la cara visible del IBE. Decisiones: una sola app sirve
todos los hoteles (multi-tenant por slug en URL); i18n sin lib para
evitar dep nueva; SSR forzado en availability (no se puede cachear,
varía por fecha). Build sale dentro del objetivo de Lighthouse.

**Archivos clave.**

- `apps/web-ibe/package.json` + `tsconfig.json` + `next.config.mjs` +
  `tailwind.config.ts` + `postcss.config.mjs`
- `apps/web-ibe/src/app/page.tsx` (landing)
- `apps/web-ibe/src/app/h/[slug]/page.tsx` (hotel home)
- `apps/web-ibe/src/app/h/[slug]/availability/page.tsx`
- `apps/web-ibe/src/app/manage/page.tsx` + `apps/web-ibe/src/app/h/page.tsx`
- `apps/web-ibe/src/lib/i18n.ts` + `apps/web-ibe/src/lib/api.ts`
- `apps/web-ibe/Dockerfile` + `fly.toml`
- `RUNBOOK.md` §20.7

**Sigue pendiente** (W3/W4 + follow-ups):

- **W3 Booking flow**: página `/h/<slug>/book`, Stripe Elements
  on-session, confirmación.
- **W4 Manage**: lookup por code+lastName, cancelación con política.
- Schema.org `LodgingReservation` (espera a la página de confirmación).
- Cookie de locale (hoy solo `?lang=`); proper hreflang en `<head>`.
- Custom domain por property (`book.<hotel>.es` → diseño Sprint 9).
- Lighthouse measurement real cuando esté deployado.
- Tests e2e Playwright del flujo completo (W3 + W4 los necesitan).

---

## 2026-05-17 · [FEAT] · Sprint 8 W1 — API pública IBE

**Scope:** `packages/db`, `apps/api/public-ibe`, `RUNBOOK.md`
**Branch:** `claude/s8-w1-public-api`
**Refs:** este commit

**Qué cambió.**

- **DB.** Migration `20260612000000_property_public_slug`:
  `properties.public_slug` (TEXT, unique partial) + `published_at`
  (TIMESTAMPTZ). El IBE solo expone properties con `published_at IS NOT
  NULL`. El slug es opaco (no expone tenantId/propertyId).
- **Módulo nuevo** `apps/api/src/public-ibe`:
  - `PublicIbeService` con 5 acciones:
    - `getProperty(slug)`: metadata pública.
    - `searchAvailability(slug, query)`: disponibilidad por room type
      reusando la lógica de availability del back-office.
    - `createReservation(slug, body)`: crea Reservation + Folio +
      Guest. Valida occupancy ≤ maxOccupancy, GDPR consent obligatorio.
      `source = DIRECT`, `notes = 'Reserva creada desde IBE público'`.
    - `getReservation(slug, code, lastName)`: verificación débil
      (code + lastName) con `mode: 'insensitive'`.
    - `cancelReservation(slug, code, body)`: aplica política. Si hay
      penalización > 0 y `acceptPenalty=false`, responde 409 con el
      monto.
  - `RateLimitGuard` in-memory (sin nueva dep `@nestjs/throttler`).
    Decorator `@RateLimit({ max, windowMs })` por endpoint.
  - `PublicIbeController` con `@Public()` + guard global + decoradores.
  - DTOs Zod: `AvailabilityQuery`, `CreatePublicReservationDto`,
    `LookupReservationQuery`, `CancelPublicReservationDto`.
- **Sentinel actor** `00000000-0000-0000-0000-000000000000` para audit.
  Correlation id por request (`ibe-<rand>`).
- **Eventos emitidos.** `reservation.created` con source=DIRECT y
  payload completo; `reservation.cancelled` con
  `reason = "Cancelada por el huésped desde IBE"` y `policyApplied`.
- **Cálculo de penalización V1.** Usa
  `CancellationPolicy.hoursBeforeArrival` + `penaltyPct`. Sin política
  → 0. La penalización NO se cobra automáticamente — el operador la
  resuelve desde back-office (Stripe Fase 2 si aplica).
- **Tests.** 9 casos: rate-limit guard (no decorator, max calls,
  separación por IP); service (slug no publicado, arrival inválido,
  search ok con overlap, createReservation valida GDPR, persistencia +
  event, lookup mismatch).
- **RUNBOOK §20** documenta publicación, endpoints + rate-limits,
  identidad/audit, política de cancelación y eventos.

**Por qué.**

Sprint 8 W1 — la base para la app `web-ibe` (W2/W3/W4). Sin esta API
pública el huésped final no tiene punto de entrada. Decisiones de
diseño orientadas a producción: slug opaco para que el hotel decida
cuándo expone, gating por `published_at`, rate-limit defensivo, GDPR
explícito, sentinel actor para audit limpio.

**Desviaciones del plan.**

- Rate-limit con guard in-memory en lugar de `@nestjs/throttler` (la
  dep requiere ADR + aprobación PO). Cuando se valide piloto con
  tráfico real, migrar a throttler + Redis.
- No incluye refactor de `RoomsService.searchAvailabilityByType` —
  duplico la lógica de disponibilidad dentro de `PublicIbeService`
  para no tocar paths autenticados. Si el patrón se repite en W2/W3,
  extraer a un helper compartido.

**Archivos clave.**

- `packages/db/prisma/migrations/20260612000000_property_public_slug/migration.sql`
- `packages/db/prisma/schema.prisma` (Property: publicSlug + publishedAt)
- `apps/api/src/public-ibe/public-ibe.service.ts` (+ spec)
- `apps/api/src/public-ibe/public-ibe.controller.ts`
- `apps/api/src/public-ibe/public-ibe.dto.ts`
- `apps/api/src/public-ibe/public-ibe.types.ts`
- `apps/api/src/public-ibe/rate-limit.guard.ts` (+ spec)
- `apps/api/src/public-ibe/index.ts` (módulo)
- `apps/api/src/app.module.ts` (registro)
- `RUNBOOK.md` §20

**Sigue pendiente** (W2/W3/W4 + follow-ups):

- App `apps/web-ibe` (W2).
- Booking flow + Stripe Elements (W3).
- Manage my reservation (W4).
- Email service real (handoff Sprint 9 — V1 emite eventos, no envía).
- Captcha / Turnstile si hay abuso en piloto.
- Migrar rate-limit a `@nestjs/throttler` cuando haya multi-instancia.
- Extraer helper de disponibilidad compartido si W2/W3 lo necesitan.

---

## 2026-05-16 · [DOCS] · SPRINT-8-PLAN.md — Online Booking Engine V1

**Scope:** docs
**Branch:** `claude/sprint-8-plan`
**Refs:** este commit

**Qué cambió.**

- Nuevo `docs/SPRINT-8-PLAN.md` con 4 workstreams centrados en **IBE**:
  - **W1** API pública (`/public/properties/:slug`, `/availability`,
    `/reservations`, `/manage`) con rate-limit por IP+slug.
  - **W2** App `apps/web-ibe` (Next.js 15, mobile-first, ES/EN,
    schema.org markup, Lighthouse ≥ 90).
  - **W3** Booking flow + Stripe Elements on-session (PaymentIntent
    si el hotel exige prepago, SetupIntent + cobro al check-in si no).
  - **W4** "Manage my reservation" — código + apellido para ver,
    cancelar con política aplicada, reenviar email.
- Migración mínima esperada: solo `properties.slug` unique + posible
  `is_published`.
- Orden: W1 → W2 → W3 → W4.

**Por qué.**

PROJECT.md §4.4 listaba "Booking engine propio" como V2 post-MVP.
Decisión PO recogida ("Aubergine es un PMS con implementación de
sistema de reservas online") lo eleva a entregable Sprint 8 — es lo
único que falta para que el SaaS sea una alternativa real a Booking.com
desde la perspectiva del hotelero.

Channel Manager, modelo CV local, onboarding wizard, email service real
y memoria semántica V1.1 quedan handoff explícito a Sprint 9.

**Archivos clave.**

- `docs/SPRINT-8-PLAN.md`

---

## 2026-05-16 · [FEAT] · Sprint 7 W3 — CV inspección HSK con Claude Vision

**Scope:** `apps/api/housekeeping`, `apps/web-hsk`, `RUNBOOK.md`
**Branch:** `claude/s7-w3-cv`
**Refs:** este commit

**Qué cambió.**

- **API.** `InspectionService` nuevo:
  - Acepta `data:image/...;base64,...`, valida tarea `IN_PROGRESS` o
    `COMPLETED` (retries idempotentes).
  - Guarda foto vía `PhotoStorageService.storeIn('hsk-inspection',
    tenantId, taskId, dataUrl)` — driver inline en dev, S3 en prod.
  - Llama `@anthropic-ai/sdk` (sin nueva dep — reusa el cliente del
    copilot) con bloque `image` + prompt ES pidiendo JSON estricto
    `{verdict, issues, confidence, reasoning}`.
  - Parser `parseVerdict` strip-fences + valida shape + clamp
    confidence + filtra issues no-string.
  - Persiste en `housekeeping_tasks.attributes.inspection`. Si
    `verdict === 'damaged'` y la tarea tiene `roomId`, marca la
    habitación `OUT_OF_ORDER`.
- **PhotoStorageService** ganó `storeIn(subdir, tenantId, id, dataUrl)`
  generalizado. `store()` antiguo queda como wrapper retrocompatible.
- **Endpoint** `POST /housekeeping/tasks/:id/inspect` con DTO
  `InspectTaskDto` (data URL ≥50, ≤6 MB).
- **HSK PWA.** `InspectionPanel` client component bajo la tarea
  COMPLETED. Selector de foto (con `capture="environment"` para abrir
  cámara), preview, llamada al proxy, feedback con verdict + reasoning
  + lista de issues. Aviso especial cuando `damaged` (habitación OOO).
- **Proxy** `apps/web-hsk/src/app/api/proxy/tasks/[id]/inspect/route.ts`
  con auth bearer.
- **Tests.** `inspection.service.spec.ts` — 6 casos del parser:
  JSON plano, fences ```json…```, clamp confidence, verdict desconocido,
  no-JSON, cap issues a 10. 44/44 verde en `src/housekeeping`.
- **RUNBOOK §19** documenta endpoint, modelo, persistencia, privacidad
  (foto cruza a Anthropic — subprocesador en DPA), desactivarlo y
  coste estimado ($0.012/inspección con Sonnet-4-6).

**Por qué.**

Sprint 7 §4 cierra el último entregable del sprint. La camarera no
tiene que decidir entre "limpia/sucia" subjetivamente — un modelo
mira la foto y razona. Cuando ve daños reales (sábana rota, fuga,
mueble roto), la habitación pasa a OOO automáticamente y mantenimiento
recibe la alerta. ADR-020 mantenido — el modelo solo emite señal, el
supervisor decide si actúa.

**Archivos clave.**

- `apps/api/src/housekeeping/inspection.service.ts` (+ spec)
- `apps/api/src/housekeeping/photo-storage.service.ts` (`storeIn`)
- `apps/api/src/housekeeping/dto.ts` (`InspectTaskDto`)
- `apps/api/src/housekeeping/tasks.controller.ts` (endpoint)
- `apps/api/src/housekeeping/housekeeping.module.ts` (provider)
- `apps/web-hsk/src/app/task/[id]/inspection-panel.tsx`
- `apps/web-hsk/src/app/task/[id]/task-actions.tsx` (mount)
- `apps/web-hsk/src/app/api/proxy/tasks/[id]/inspect/route.ts`
- `apps/web-hsk/src/lib/api.ts` (`inspectTask` + `InspectionResult`)
- `RUNBOOK.md` §19

**Sigue pendiente** (fuera de scope W3):

- Dataset sintético `infra/test-fixtures/hsk-photos/*` con 50
  imágenes etiquetadas (el plan §4.4 lo mencionaba). Se difiere al
  momento en que un e2e de Playwright lo necesite. Hoy las pruebas
  manuales se hacen con cualquier foto del móvil.
- Modelo propio (no Claude Vision) cuando el dataset real acumule
  1000+ inspecciones. ADR del sprint siguiente.
- Re-inspect (volver a llamar tras corregir) ya funciona — sobreescribe
  `attributes.inspection`. Documentar UX para hilo de inspecciones si
  el operador lo pide.

**Sprint 7 completo en código (W1+W2+W3+W4).** Las 4 ramas siguen sin
merge a `main`.

---

## 2026-05-16 · [FEAT] · Sprint 7 W2 — Memoria semántica huésped (tsvector V1)

**Scope:** `packages/db`, `packages/mcp-tools`, `apps/api/copilot/memory`,
`RUNBOOK.md`
**Branch:** `claude/s7-w2-memory`
**Refs:** este commit

**Qué cambió.**

- **DB.** Migration `20260611000000_guest_memory_chunks`:
  - Enum `guest_memory_source_kind` (CARDEX, STAY_NOTE, FOLIO_NOTE,
    SPECIAL_REQUEST).
  - Tabla `guest_memory_chunks` con `chunk_text TEXT`, columna generada
    `tsv TSVECTOR (to_tsvector('spanish', chunk_text))` stored, GIN
    index. `vector_pending BOOL DEFAULT TRUE` deja la columna para
    embeddings reales V1.1.
  - Unique `(guest_id, source_kind, source_ref)` idempotente.
  - RLS por `tenant_id`.
- **Servicio** `apps/api/src/copilot/memory/memory.service.ts`:
  - `ingestForGuest`: lee cardex (datos básicos, doc, membership,
    notas, `attributes.preferences/allergies`) + últimas 10 reservas
    con folio entries y solicitudes especiales. DeleteMany + createMany
    para reescribir limpio.
  - `recall(guestId, query, limit)`: `ts_rank` sobre
    `plainto_tsquery('spanish', query)`. Auto-ingesta lazy si no hay
    chunks aún. Devuelve `{ chunks: [{sourceKind, sourceRef, text,
    score}], ingested }`.
- **Tool MCP** `recall_guest_history` (read-only, auto-exec) en
  `foToolCatalog`. Tipo `RecallGuestHistoryInput` exportado.
- **`FoToolRouter`** ruta `recall_guest_history` al `MemoryService`.
  `CopilotModule` registra `MemoryService` como provider.
- **Tests** `memory.service.spec.ts` — 5 casos: lazy ingest + query,
  skip ingest si ya hay chunks, no matches, ingesta produce los 4 kinds,
  ingesta mínima (solo cardex) si guest sin estancias.
- **RUNBOOK §18** documenta V1 vs V1.1, ingesta lazy, privacidad GDPR.

**Por qué.**

Sprint 7 §3 entrega memoria persistente del huésped para el copilot.
**Deviación intencionada del plan:** retrieval con tsvector en lugar de
`pgvector + text-embedding-3-small`. Razón — añadir `openai` como dep
requiere ADR + aprobación PO (CLAUDE.md §8). El esqueleto y contrato
quedan idénticos: tabla, ingesta, tool, prompt; solo cambia el motor de
ranking. `vector_pending` marca el camino a V1.1 cuando se apruebe la
dep, y la migración será expand-only.

**Archivos clave.**

- `packages/db/prisma/migrations/20260611000000_guest_memory_chunks/migration.sql`
- `packages/db/prisma/schema.prisma` (`GuestMemoryChunk` + enum +
  back-relations en Tenant y Guest)
- `packages/db/src/index.ts` (exports)
- `apps/api/src/copilot/memory/memory.service.ts` + spec
- `apps/api/src/copilot/tool-router.ts` (case `recall_guest_history`)
- `apps/api/src/copilot/copilot.module.ts` (provider)
- `packages/mcp-tools/src/catalog/fo.ts` (tool entry + input schema)
- `packages/mcp-tools/src/index.ts` (export del tipo)
- `RUNBOOK.md` §18

**Sigue pendiente** (fuera de scope W2 V1):

- **V1.1: embeddings reales.** Añadir `openai` (o Voyage) como dep
  con ADR; popular columna `embedding vector(1536)` en ingesta y usar
  pgvector KNN como segundo ranker (híbrido tsvector + cosine).
- Hook automático en `reservations.service.checkOut` para re-ingestar
  tras cerrar estancia. Hoy la re-ingesta solo ocurre lazy al recall.
- Prompt del copilot Anthropic: añadir hint para que llame
  `recall_guest_history` cuando el operador pregunte por preferencias /
  alergias / históricos del huésped. Hoy disponible pero el LLM debe
  descubrirlo del catálogo.
- Tool `find_guests_by_name(query)` para encadenar `recall` cuando el
  operador usa nombre en vez de UUID.

---

## 2026-05-16 · [FEAT] · Sprint 7 W4 — Seed sintético multi-hotel

**Scope:** `scripts`, `RUNBOOK.md`
**Branch:** `claude/s7-w4-seed`
**Refs:** este commit

**Qué cambió.**

- `scripts/seed-synthetic.ts`: CLI parametrizable que genera N
  properties × M habitaciones × K reservas/mes × H meses de historia
  con estacionalidad realista (jul/ago 1.5×, ene/feb 0.55×) y status
  coherentes con la fecha (CHECKED_OUT pasadas, CHECKED_IN actuales,
  PENDING/CONFIRMED futuras, ~8% CANCELLED, ~4% NO_SHOW). Folio
  entries por noche, payment final en CHECKED_OUT. Membership levels
  Gold/Platinum/VIP en ~25% de huéspedes. Agencia/Empresa en
  fracciones realistas.
- LCG determinista (`--seed`) para reproducibilidad.
- Salvaguardas: aborta contra hosts productivos (`fly.dev`,
  `flycast`, RDS, Supabase, Neon) salvo `--force-prod`.
- Todo lo generado lleva `attributes.synthetic = true` para `--reset`
  selectivo.
- RUNBOOK §17 documenta uso, flags, qué genera y limpieza.

**Por qué.**

Sprint 7 §7 ordena W4 antes que W2 (memoria semántica) y W3 (CV) porque
ambos dependen de tener datos realistas. Decisión PO recogida en
SPRINT-7-PLAN: el sprint procede sin piloto operando — el seed cubre
esa falta. También sirve para demos comerciales (3 hoteles con 2 años
de historia se ven creíbles) y regresiones reproducibles.

**Archivos clave.**

- `scripts/seed-synthetic.ts`
- `RUNBOOK.md` §17

**Sigue pendiente** (fuera de scope W4):

- Variabilidad por dayofweek (fin de semana vs entre semana): hoy la
  distribución es uniforme dentro del mes.
- Generar fotos sintéticas lost-found para W3 CV (cuando lleguemos a
  W3 lo añadimos como `seed-synthetic-photos.ts` o flag opcional).
- Cardex documentos (DNI/pasaporte sintéticos): hoy solo nombre +
  email. El SES.HOSPEDAJES sender lo necesitaría en producción.

---

## 2026-05-16 · [FEAT] · Sprint 7 W1 — Voice-first FO (folio)

**Scope:** `apps/web-fo`, `RUNBOOK.md`
**Branch:** `claude/s7-w1-voice-fo`
**Refs:** este commit

**Qué cambió.**

- **Parser.** `apps/web-fo/src/lib/voice-fo-grammar.ts`:
  `parseVoiceFoCommand(text)` devuelve intent tipado
  `add_charge | add_payment` o null. Funcion pura. Normaliza acentos,
  acepta números 0-99 en palabras ES (`treinta y cinco`), euros (`35€`,
  `35 euros`), describe verbos cobrar/pagar como pago y carga/cargo como
  cargo, infiere paymentMethod por keywords (`efectivo` → CASH,
  `tarjeta` → CARD, `transferencia` → BANK_TRANSFER), extrae habitación
  (`la 305`, `habitacion 7`) y description (`por limpieza`).
- **UI.** `apps/web-fo/src/components/FolioVoiceButton.tsx` (client):
  botón de micro + transcript + preview del intent + buttons "Aplicar al
  cargo" / "Aplicar al pago". Pre-rellena los inputs de los forms
  server-action existentes vía DOM querySelector + native `value` setter
  + dispatch input/change. Fallback silencioso si el browser no soporta
  Web Speech API.
- **Integración.** Sección folio en `/reservations/[id]` envuelve los
  forms en `#folio-forms .folio-forms-grid` y monta el botón encima.
  Server actions intactas.
- **RUNBOOK §16.7** documenta uso, gramática V1, privacidad y el
  follow-up de walk-in.

**Por qué.**

Cierra el primer entregable de Sprint 7. Una recepcionista con manos
ocupadas (teléfono / huésped) dicta el cargo y revisa antes de enviar.
Audio nunca sale del dispositivo (igual que W3 HSK). Cero cambios al
backend — los endpoints existentes capturan los inputs pre-rellenados.

**Archivos clave.**

- `apps/web-fo/src/lib/voice-fo-grammar.ts`
- `apps/web-fo/src/components/FolioVoiceButton.tsx`
- `apps/web-fo/src/app/reservations/[id]/page.tsx` (import + monta el
  botón + envuelve los forms)
- `RUNBOOK.md` §16.7

**Sigue pendiente** (fuera de scope W1):

- Walk-in vía voz en `/reservations/new`: requiere parser de nombre +
  fechas + room type y un orquestador del wizard de 3 pasos. Lo deferimos
  a W1.1 cuando alguien lo pida.
- Tests del parser: web-fo no tiene vitest; añadirlo solo por esto es
  scope deviation (igual que W3 HSK). El parser es pequeño y type-safe;
  la cobertura llegará vía e2e Playwright cuando montemos fake media.
- Voice-first en /folio del cardex (cuando exista UI específica para
  cargos no asociados a reservation).

---

## 2026-05-16 · [DOCS] · SPRINT-7-PLAN.md — Discovery formal

**Scope:** docs
**Branch:** `claude/sprint-7-plan`
**Refs:** este commit

**Qué cambió.**

- Nuevo `docs/SPRINT-7-PLAN.md` con 4 workstreams:
  - **W1** Voice-first FO (cargos/walk-in dictados; reutiliza W3 HSK).
  - **W2** Memoria semántica huésped (pgvector + RAG + tool MCP
    `recall_guest_history`).
  - **W3** Visión por computadora HSK (Claude Vision sobre foto post-clean;
    persistencia en `housekeeping_tasks.attributes.inspection`).
  - **W4** Seed sintético multi-hotel (`scripts/seed-synthetic.ts`) con 24
    meses de historia realista — desbloquea W2/W3 sin esperar al piloto.
- Decisión PO recogida: Sprint 7 procede **sin gating de piloto real**;
  donde haga falta historial se genera vía W4.
- Orden de ejecución sugerido: W1 → W4 → W2 → W3.

**Por qué.**

Sprint 6 cerró código pero los pilotos reales no están operando. Sprint 7
necesita un plan formal antes de Build (per ciclo: Intake → Discovery →
Design → Ready → Build). El plan también captura lo que NO entra (otros
idiomas, audio en servidor, CV propio, GTM) para evitar drift en sesiones
futuras.

**Archivos clave.**

- `docs/SPRINT-7-PLAN.md`

**Sigue pendiente.**

- Ejecutar W1-W4 en sus branches dedicadas.

---

## 2026-05-16 · [INTEGRATION] · Stripe Fase 2 — cobro off-session no-show

**Scope:** `apps/api/payments`, `apps/web-fo`, `RUNBOOK.md`
**Branch:** `claude/stripe-fase-2-noshow`
**Refs:** este commit

**Qué cambió.**

- **API.** `StripeService.chargeNoShow(user, cid, reservationId, { amount,
  description? })`:
  - Valida amount > 0, reserva existe, tarjeta tokenizada, folio OPEN.
  - Idempotencia previa: si ya hay folio entry con `idempotencyKey
    = stripe-no-show-{reservationId}`, devuelve `already_charged` sin
    tocar Stripe.
  - Crea `PaymentIntent` con `off_session: true, confirm: true`,
    `customer` y `payment_method` del Fase 1; pasa `idempotencyKey` a
    Stripe.
  - Si `status=succeeded`, postea folio entry CHARGE vía `FolioService.
    addCharge` (idempotente) y guarda `stripePaymentIntentId` +
    `stripeChargeId` en `folio_entries.attributes`.
  - Maneja `authentication_required` y `requires_action` → devuelve
    `requires_action` para que el operador retome on-session.
- `PaymentsModule` ahora importa `FolioModule` para resolver
  `FolioService`.
- **Endpoint** `POST /payments/stripe/reservations/:id/charge-no-show`
  con DTO Zod inline (`{ amount: number > 0, description?: string }`),
  roles `tenant_admin | front_desk`.
- **UI web-fo.** Nuevo `NoShowChargeButton` (client component) en
  `/reservations/[id]` cuando `status=NO_SHOW`, `guaranteeStatus=SECURED`
  y `stripeCardLast4`: muestra brand+last4, input de amount (default =
  totalAmount), feedback por status (succeeded / already_charged /
  requires_action / failed). `router.refresh()` tras éxito.
- **Proxy** `app/api/payments/charge-no-show/[id]/route.ts` + helper
  `chargeNoShow` y tipo `NoShowChargeResult` en `lib/api.ts`.
- **RUNBOOK §16.6** documenta endpoint, idempotencia, SCA, refund
  (manual V2) y trazabilidad.
- **Tests.** `stripe.service.spec.ts` — 5 casos: amount inválido,
  already_charged, happy path con args correctos a Stripe, SCA, reserva
  sin tarjeta. Mock global del SDK.

**Por qué.**

Cierra el corte comercial del módulo de payments. Fase 1 tokeniza la
tarjeta y deja la reserva SECURED; Fase 2 cierra el ciclo cuando el
huésped no llega — el hotel deja de comer la pérdida y el recepcionista
no tiene que llamar al banco. Idempotencia obligatoria por PCI/UX (un
operador nervioso puede dar doble clic). Refund queda V2 — no es
bloqueante para piloto y el dashboard de Stripe ya cubre el caso de
errores.

**Archivos clave.**

- `apps/api/src/payments/stripe.service.ts` (`chargeNoShow`)
- `apps/api/src/payments/stripe.service.spec.ts` (nuevo, 5 tests)
- `apps/api/src/payments/stripe.controller.ts` (endpoint + DTO inline)
- `apps/api/src/payments/index.ts` (`PaymentsModule` importa FolioModule)
- `apps/web-fo/src/components/NoShowChargeButton.tsx`
- `apps/web-fo/src/app/reservations/[id]/page.tsx` (sección condicional)
- `apps/web-fo/src/app/api/payments/charge-no-show/[id]/route.ts`
- `apps/web-fo/src/lib/api.ts` (helper + tipo)
- `RUNBOOK.md` §16.6

**Sigue pendiente** (fuera de scope Fase 2):

- Refund automatizado (`refund-no-show`): cuando el huésped reclama,
  hoy hay que devolver desde el Stripe Dashboard y meter contra-cargo
  manual. V3.
- Manejo programático de SCA con un `confirm-no-show-intent` parecido
  al de Fase 1 cuando `requires_action`. Hoy se redirige al operador a
  hacerlo on-session.
- Webhook subscription a `payment_intent.payment_failed` para reflejar
  fallos asincrónicos (hoy todo es síncrono porque hacemos confirm:true).

---

## 2026-05-16 · [FEAT] · Reservations UI v2 Iter B — Agencia/Empresa/VIP

**Scope:** `packages/db`, `apps/api/reservations`, `apps/web-fo`
**Branch:** `claude/reservations-iter-b`
**Refs:** este commit

**Qué cambió.**

- **DB.** Migration `20260610000000_reservation_agency_guest_vip`:
  - `reservations.agency_name` y `reservations.company_name` (TEXT
    NULL, string denormalizado V1 — catálogo con FK queda para cuando
    el revenue manager lo justifique).
  - `guests.membership_level` (TEXT NULL, libre: "Gold", "Platinum",
    "VIP" o lo que use el hotel).
  - Índices parciales `WHERE col IS NOT NULL` para no pesar en
    propiedades sin uso.
- **API.**
  - `CreateReservationDto` acepta `agencyName`, `companyName`.
  - `PatchReservationDto` acepta los dos como nullable.
  - `guestDataShape` acepta `membershipLevel`.
  - `RESERVATION_RICH_LIST_SELECT` y `RESERVATION_DETAIL_SELECT` devuelven
    los nuevos campos + `primaryGuest.membershipLevel`.
  - `toRichListItem` y `toDetail` propagan al view.
- **UI.**
  - Columna "Huésped" muestra badge ámbar uppercase con el
    `membershipLevel` cuando lo hay (Gold/Platinum/VIP/etc.).
  - Columna "Agencia / Empresa" prioriza `agencyName || companyName ||
    organizerName` (antes solo mostraba `organizerName`).

**Por qué.**

PROJECT.md §0 listaba "Iter B (campos Agencia/Empresa/VIP) pendiente" en
el track commercial-grade. Con los campos vacíos las columnas Iter A
quedaban descriptivas pero sin datos — esto cierra esa promesa visual
y permite filtrar/buscar por agencia o nivel VIP cuando la UI lo pida.

**Archivos clave.**

- `packages/db/prisma/schema.prisma` (`Reservation` + `Guest`)
- `packages/db/prisma/migrations/20260610000000_reservation_agency_guest_vip/migration.sql`
- `apps/api/src/reservations/dto.ts` (CreateReservationDto + Patch + guestData)
- `apps/api/src/reservations/reservations.service.ts` (selects, mappers,
  patch, create, guest ad-hoc)
- `apps/web-fo/src/lib/api.ts` (tipos)
- `apps/web-fo/src/components/ReservationsTable.tsx`

**Sigue pendiente** (fuera de scope Iter B):

- Filtros por agencia/empresa/membership en `ReservationsFilters` y
  smart-search regex. Trivial de añadir cuando el operador lo pida.
- Catálogo `agencies` y `companies` con FKs cuando el revenue manager
  necesite analytics agregadas.
- `membershipLevel` como enum normalizado cuando varios hoteles
  converjan en taxonomía común.
- Próximo del track commercial-grade: **Stripe Fase 2** (cobro
  off-session no-show con `PaymentIntent` sobre el `stripePaymentMethodId`).

---

## 2026-05-16 · [FEAT] · Cerrar Sprint 6 W5 — Reservation copilot embebido (streaming)

**Scope:** `apps/web-fo`, `RUNBOOK.md`
**Branch:** `claude/copilot-w5-embedded`
**Refs:** este commit

**Qué cambió.**

- Nuevo helper `apps/web-fo/src/lib/copilot-stream.ts`: parser SSE
  `streamCopilotMessage(sessionId, content)` sobre fetch +
  ReadableStream (EventSource no soporta POST). Yields eventos
  tipados `{status|tool_call|tool_result|done|error}` listos para el
  consumer.
- Proxy `apps/web-fo/src/app/api/copilot/sessions/[id]/messages/route.ts`
  ahora detecta `?stream=true` y hace passthrough del cuerpo SSE de la
  API (con auth bearer del session). Sin stream, conserva el JSON
  comportamiento previo.
- `CopilotSidebar.send()` migrado a streaming: muestra una traza viva
  en el drawer ("Pensando…", "→ tool", "← tool ok") mientras corre el
  agentic loop; al recibir `done` reemplaza con el `SessionView` final.
  Atajo ⌘K se mantiene; confirmación inline `PendingToolCard` también.
- `RUNBOOK.md` §16.5: documentación de dónde aparece el drawer,
  streaming, confirmación inline y limitaciones (phase events siguen
  acumulándose por turno; token-level deltas pendientes).

**Por qué.**

Sprint 6 DoD #5. El operador ya tenía el drawer y la confirmación
inline desde Sprint 5; lo que faltaba era hacerlo visible mientras la
LLM razona. Importante con Sonnet 4.6 + agentic loop: una pregunta como
"reserva walk-in para Juan Pérez del 10 al 12 en doble estándar" puede
encadenar `list_room_types → search_availability_by_type →
create_reservation` y tarda 5-10s. Sin feedback el operador piensa que
se colgó.

`CopilotSidebar` ya estaba montado globalmente desde el root layout, por
lo que `/calendar` y `/reservations/new` heredan el drawer sin trabajo
extra.

**Archivos clave.**

- `apps/web-fo/src/lib/copilot-stream.ts`
- `apps/web-fo/src/app/api/copilot/sessions/[id]/messages/route.ts`
- `apps/web-fo/src/components/CopilotSidebar.tsx`
- `RUNBOOK.md` §16.5

**Sigue pendiente** (fuera de scope W5):

- Live emission de phase events durante el loop (el server los acumula y
  los emite tras la resolución; el cliente ya está preparado para
  consumirlos incrementalmente cuando el server lo haga).
- Token-level deltas (`event: delta`): el contrato SSE ya los acepta;
  falta cambiar `client.beta.messages.create` por `.stream(...)` en
  `AnthropicAdapter`.
- E2E Playwright que verifica streaming + confirmación inline en
  `/calendar` y `/reservations/new`.

**Sprint 6 IA V1 completo (W1+W2+W3+W4+W5).** Las 5 ramas siguen sin
mergear a `main` — pendiente de validación del piloto antes de
consolidar.

---

## 2026-05-16 · [FEAT] · Cerrar Sprint 6 W4 — Forecasting (Holt)

**Scope:** `apps/api/night-audit`, `packages/mcp-tools`, `apps/web-fo`,
`RUNBOOK.md`
**Branch:** `claude/na-w4-forecast`
**Refs:** 2 commits en la rama

**Qué cambió.**

- `ForecastService` con Holt double exponential smoothing **sin deps
  externas** (grid search alpha/beta minimizando SSE in-sample, bandas
  95% derivadas de σ de residuales × √horizon). Soporta `occupancy`,
  `adr`, `revpar` (desde `night_audit_snapshots[MANAGER]`) y `pickup`
  (consulta directa a reservations con created_at = arrival_date).
  Ventana de training 365d; rechaza series < 14 puntos con mensaje claro.
- Endpoint `GET /night-audit/forecast?propertyId=&horizon=&metric=`,
  roles `tenant_admin | front_desk | night_auditor`.
- MCP tool `forecast_demand` (read-only, auto-exec) en `foToolCatalog`,
  enrutado en `FoToolRouter`. `CopilotModule` ahora importa
  `NightAuditModule` para resolver `ForecastService`.
- UI `apps/web-fo/src/app/dashboard/forecast/page.tsx`: selector
  property + metric + horizon (7/14/30/60/90), KPIs (RMSE, MAPE),
  gráfico SVG inline con history + predicted dashed + banda 95%
  rellena, tabla de puntos. Link "Forecast" añadido al nav.
- Helper `getForecast` + tipos en `apps/web-fo/src/lib/api.ts`.
- `RUNBOOK.md` §16.4 documenta modelo, métricas, fuentes de datos,
  endpoint, UI y limitaciones (sin estacionalidad semanal — Holt-Winters
  pleno queda para V2).

**Por qué.**

Sprint 6 DoD #4: el revenue manager y la dirección obtienen una primera
proyección numérica sin abrir un Excel. Holt simple es defendible para
30 días y razonable hasta 90; resolver Holt-Winters propiamente requiere
≥90 días de historia real por property, que aún no tenemos en piloto.
La elección de **no añadir `simple-statistics`** (la dep que sugería el
plan) evita scope deviation por CLAUDE.md §8: el algoritmo cabe en ~50
líneas y mantiene `apps/api` libre de dependencias estadísticas
adicionales hasta que las regresiones o EWMA realmente las pidan.

**Archivos clave.**

- `apps/api/src/night-audit/forecast.service.ts` (+ spec, 4 tests)
- `apps/api/src/night-audit/night-audit.controller.ts` (`GET /forecast`)
- `apps/api/src/night-audit/dto.ts` (`ForecastQuery`)
- `apps/api/src/night-audit/night-audit.module.ts` (provider + export)
- `packages/mcp-tools/src/catalog/fo.ts` (`forecast_demand` + input
  schema + tipo `ForecastDemandInput`)
- `packages/mcp-tools/src/index.ts` (export del tipo)
- `apps/api/src/copilot/tool-router.ts` (case `forecast_demand`)
- `apps/api/src/copilot/copilot.module.ts` (`imports: [..., NightAuditModule]`)
- `apps/web-fo/src/app/dashboard/forecast/page.tsx`
- `apps/web-fo/src/lib/api.ts` (`getForecast`, tipos)
- `apps/web-fo/src/app/layout.tsx` (link nav)
- `RUNBOOK.md` §16.4

**Sigue pendiente** (fuera de scope W4):

- Estacionalidad semanal: Holt-Winters completo cuando ≥90 días de
  historia real por property.
- Backtesting con holdout temporal (hoy MAPE/RMSE son in-sample —
  optimistas). Trivial añadir un parámetro `holdoutDays`.
- Workstream Sprint 6 restante: W5 (Reservation copilot embebido en
  `/calendar` y `/reservations/new` con streaming token-by-token).

---

## 2026-05-16 · [FEAT] · Cerrar Sprint 6 W3 — Voice-first HSK

**Scope:** `apps/web-hsk`, `RUNBOOK.md`
**Branch:** `claude/hsk-w3-voice`
**Refs:** este commit

**Qué cambió.**

- Nuevo `voice-keywords.ts`: parser puro que mapea transcript ES a
  `RoomStatusKeyword ∈ {CLEAN, DIRTY, INSPECTED, OUT_OF_ORDER}`.
  Reglas robustas a acentos, género/plural y typos típicos
  (`inspeccionada` / `inspecionada`); `OUT_OF_ORDER` prioritario sobre
  `CLEAN` cuando coinciden ambos.
- Nuevo `voice-button.tsx` (client component): boton flotante grande
  con Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`,
  `lang=es-ES`, `continuous=true`, `interimResults=true`). Pulse-aria,
  feedback con interim transcript, fallback silencioso si el browser
  no soporta. **Audio nunca sale del dispositivo** (PCI/GDPR ok por
  diseño, nada que transmitir).
- `task-actions.tsx` integra el botón cuando la tarea esta `IN_PROGRESS`:
  cada transcript final se concatena al campo `notas`; si dispara
  keyword, auto-selecciona el `resultingRoomStatus`.
- RUNBOOK §16.3 documenta uso, privacidad, soporte de browsers y
  cómo desactivarlo a nivel user agent.

**Por qué.**

Sprint 6 DoD #3 — manos libres en el carro de limpieza. La camarera
puede dictar "habitación 305 limpia, falta toalla" sin sacar el guante
del bolsillo. Audio local cierra la pregunta GDPR (no hay transferencia
biométrica).

**Archivos clave.**

- `apps/web-hsk/src/app/task/[id]/voice-keywords.ts`
- `apps/web-hsk/src/app/task/[id]/voice-button.tsx`
- `apps/web-hsk/src/app/task/[id]/task-actions.tsx`
- `RUNBOOK.md` §16.3

**Sigue pendiente** (fuera de scope W3):

- E2E Playwright con `--use-fake-ui-for-media-stream` y stream WAV
  sintético (plan §4.3). El parser es ~30 líneas y typesafe; coverage
  llegará vía el e2e cuando montemos la infra de fake media. La opción
  intermedia (añadir vitest a web-hsk solo para este parser) se descartó
  porque introduciría una nueva devDep contra CLAUDE.md §8.
- Visualización de waveform real (hoy solo es un pulse). Trivial de
  añadir con `AnalyserNode` cuando el feedback lo pida.

---

## 2026-05-16 · [FEAT] · Cerrar Sprint 6 W2 — Anomaly Detection NA

**Scope:** `apps/api/night-audit`, `apps/web-fo`, `packages/db`, `infra/grafana`
**Branch:** `claude/na-w2-anomalies`
**Refs:** commits en la rama desde `810a7df` (DB) hasta este

**Qué cambió.**

- **DB.** Nueva tabla `night_audit_anomalies` (id, tenant, property, run,
  businessDate, kind, severity, details JSONB, reviewedAt, reviewedByUserId,
  reviewNotes). RLS por `tenant_id`, audit trigger habilitado. Nuevos
  enums `NightAuditAnomalyKind`, `NightAuditAnomalySeverity`. Valor
  `DETECT_ANOMALIES` añadido al enum `night_audit_step`.
- **Service.** `AnomalyService.detectAll(ctx)` corre 4 reglas en paralelo
  (Promise.allSettled — un fallo de regla no tumba al resto):
  - `DUPLICATE_CHARGE` (critical) — idempotency_key con amounts distintos
  - `CASH_DRAWER_VARIANCE` (high) — |discrepancy| / expected > 5%
  - `DEEP_DISCOUNT` (medium) — DISCOUNT ≥ 50% del CHARGE del folio/día
  - `CANCELLATION_SPREE` (medium) — mismo guest > 3 cancellations same-day
- **Step.** `DetectAnomaliesStep` se inserta entre `SNAPSHOT_REPORTS` y
  `CLOSE_DAY`. Idempotente por `runId` (deleteMany propio run + createMany).
  Nunca bloquea el cierre — ADR-020.
- **Métricas Prometheus** (via OTel):
  `night_audit_anomalies_total{tenant, property, kind, severity}`.
- **API.** Dos endpoints nuevos:
  - `GET /night-audit/anomalies` con filtros (propertyId, businessDate,
    from/to, kind, severity, reviewed, limit ≤ 200).
  - `PATCH /night-audit/anomalies/:id/review` idempotente — graba
    reviewedAt + reviewedByUserId + reviewNotes.
- **UI web-fo.** Página `/night-audit/anomalies` con filtros, badges por
  severity/kind y botón "marcar revisada". Link añadido al nav.
- **Observabilidad.** Dashboard `infra/grafana/dashboards/night-audit.json`
  (stats 24h, breakdown por kind, tabla severity×kind 7d) +
  alerta `NightAuditAnomalyDetected` → Slack (no page).
- **Tests.** 27/27 verdes en `src/night-audit` (incluye 6 nuevos en
  `anomaly.service.spec.ts`, pipeline y service spec actualizados al
  pipeline de 7 pasos).

**Por qué.**

Sprint 6 DoD #2: el supervisor recibe una primera señal real durante el
NA en vez de tener que revisar cada folio a mano. Cumple ADR-020 (cero
auto-corrección) y deja la decisión al humano. Habilita los workstreams
de UI revisión, alertas y queries SQL del piloto sin tocar la idempotencia
del cierre.

**Archivos clave.**

- `packages/db/prisma/migrations/20260609000000_night_audit_anomalies/migration.sql`
- `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- `apps/api/src/night-audit/anomaly.service.ts` (+ spec con 6 tests)
- `apps/api/src/night-audit/anomaly.metrics.ts`
- `apps/api/src/night-audit/steps/detect-anomalies.ts`
- `apps/api/src/night-audit/night-audit.service.ts` (pipeline 7 pasos +
  listAnomalies / reviewAnomaly)
- `apps/api/src/night-audit/night-audit.controller.ts` (GET + PATCH)
- `apps/api/src/night-audit/dto.ts` (ListAnomaliesQuery, ReviewAnomalyDto)
- `apps/web-fo/src/app/night-audit/anomalies/page.tsx`
- `apps/web-fo/src/lib/api.ts` (listNightAuditAnomalies,
  reviewNightAuditAnomaly, tipos)
- `infra/grafana/dashboards/night-audit.json`
- `infra/grafana/alerts.yaml` (nuevo grupo `aubergine-na-anomaly`)

**Sigue pendiente** (fuera de scope W2):

- `RATE_OVERRIDE` z-score: reservado en el enum pero la detección queda
  deferida a V2 — requiere persistir baseline BAR diario.
- Eventbus emission: `night_audit.anomaly_detected v1` no se emite todavía
  (los counters Prometheus + tabla cubren observabilidad; podemos añadir
  pub al EventbusService cuando un consumer lo necesite).
- Workstreams Sprint 6: W3 (Voice HSK), W4 (Forecasting), W5 (Embedded
  copilot UI).

---

## 2026-05-16 · [FEAT] · Cerrar Sprint 6 W1 — Anthropic adapter completo

**Scope:** `apps/api/copilot`, `packages/db`, `infra/grafana`
**Branch:** `claude/copilot-w1-close`
**Refs:** commits `f7a847f` (DB), `b3...` (adapter), `3cd9e0b` (metrics + lint),
`484598e` (SSE), este commit (tests + dashboard + docs)

**Qué cambió.**

- **DB.** Nueva tabla `copilot_messages` (USER, ASSISTANT, TOOL_USE,
  TOOL_RESULT) con tokens/latency/cache. RLS por tenant. Sin trigger
  audit_log porque esta tabla *es* el audit trail.
- **Adapter pattern.** `CopilotAdapter` interface + `StubAdapter` (matcher
  determinista) + `AnthropicAdapter` real (extraído de `copilot.service`,
  contrato preservado). `AdapterFactory` resuelve driver según
  `COPILOT_DRIVER` y presencia de `ANTHROPIC_API_KEY`.
- **Prompt caching.** `cache_control: { type: 'ephemeral' }` en system
  prompt + último tool del catálogo (cachea todo lo anterior). Usa
  `client.beta.messages` porque el SDK 0.32.x expone caching solo en
  beta. Telemetría incluye `cache_read_tokens` y `cache_write_tokens`.
- **Métricas Prometheus** (via OTel): `copilot_messages_total{tenant,
  role, model}`, `copilot_tokens_total{tenant, model, kind}`,
  `copilot_latency_seconds_*{tenant, model}`. Dashboard
  `infra/grafana/dashboards/copilot.json` con KPIs.
- **SSE streaming.** `POST /copilot/sessions/:id/messages?stream=true`
  devuelve `text/event-stream` con eventos `status`, `tool_call`,
  `tool_result`, `done`, `error`. Adapter recibe callbacks opcionales
  invocados durante el agentic loop.
- **Audit.** `CopilotService` persiste cada turno en `copilot_messages`
  best-effort (un fallo de DB no bloquea al usuario).
- **Env nuevas:** `COPILOT_DRIVER` (`anthropic` | `stub`), `COPILOT_MODEL`
  (default `claude-sonnet-4-6`).
- **Tests:** 19/19 verdes en copilot (12 service + 6 anthropic-adapter
  unit + 1 SSE generator). 4 fallos en `reservations.service.spec` son
  pre-existentes, no introducidos en esta rama.
- **Drive-by:** removed unused `ForbiddenException` import en
  `reservations.service.ts` para dejar lint verde (introducido en
  commit `5c462b0` de la rama anterior).

**Por qué.**

Sprint 6 DoD #1 exigía adapter real con prompt caching, audit y métricas.
El stub era suficiente para tests pero no para producción: sin caching
el coste escala con el tamaño del catálogo de tools (>40 tools); sin
audit no hay trazabilidad legal de qué pidió el operador; sin métricas
no podemos cerrar SLOs por tenant.

**Archivos clave.**

- `packages/db/prisma/schema.prisma` (`CopilotMessage` + relación en `Tenant`)
- `packages/db/prisma/migrations/20260608000000_copilot_messages/migration.sql`
- `apps/api/src/copilot/copilot.types.ts` (interfaces compartidas)
- `apps/api/src/copilot/anthropic-adapter.ts` (real, con caching)
- `apps/api/src/copilot/stub-adapter.ts` (determinista)
- `apps/api/src/copilot/adapter-factory.ts` (DI factory)
- `apps/api/src/copilot/copilot.service.ts` (refactor, persist, métricas, SSE)
- `apps/api/src/copilot/copilot.controller.ts` (SSE endpoint)
- `apps/api/src/copilot/metrics.ts` (OTel counters/histogram)
- `apps/api/src/config/env.schema.ts` (COPILOT_DRIVER, COPILOT_MODEL)
- `infra/grafana/dashboards/copilot.json`

**Sigue pendiente** (no bloqueante de W1):

- Token-level streaming del modelo (cambiar `client.beta.messages.create`
  por `.stream(...)` en el final-text branch). Infra SSE ya está.
- Live emission de phase events durante el loop (hoy se acumulan y se
  ceden tras la resolución del turno). Requiere `EventEmitter` o canal
  async; cambio interno sin alterar contrato SSE.
- Workstream 2 (Anomaly detection NA), 3 (Voice HSK), 4 (Forecasting),
  5 (Embedded copilot UI) — próximos tickets de Sprint 6.

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
