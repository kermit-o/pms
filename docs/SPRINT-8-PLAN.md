# Sprint 8 — Online Booking Engine (IBE) V1

> **Versión:** 1.0 — 2026-05-16
> **Branch de desarrollo:** workstreams en branches dedicadas (`claude/s8-w<N>-<topic>`).
> **Documento padre:** [`PROJECT.md`](../PROJECT.md) §4.4 (booking engine
> propio) + Sprint 7 §8 (handoff).
> **Predecesores:** Sprint 7 cerrado en código (W1-W4). Track commercial-grade
> + Sprint 6 IA V1 cerrados.

---

## 0. Norte estratégico

Aubergine ya cubre back-of-house (FO, NA, HSK, payments, AI). **Lo que
falta para ser un PMS completo según la definición SaaS** es la venta
directa al huésped sin OTA: el **Online Booking Engine**.

Decisión PO recogida 2026-05-16: "Aubergine es un PMS con implementación
de sistema de reservas online" — IBE es scope, no nice-to-have.

Sprint 8 entrega **IBE V1**: un sitio público por hotel (subdominio o
ruta) donde el huésped busca disponibilidad, selecciona habitación,
introduce sus datos y paga directamente, sin intermediario. Lo
suficiente para que un hotel pueda dejar de pagar comisiones de
Booking.com en una porción de su tráfico.

**Definition of Done de Sprint 8:**

1. **App pública `apps/web-ibe`** (Next.js 15, App Router) sin auth,
   mobile-first, multilanguage skeleton (ES/EN), SEO básico
   (schema.org Hotel/LodgingReservation), Lighthouse ≥ 90 en
   accesibilidad y performance.
2. **Endpoints públicos en API**: búsqueda de disponibilidad,
   selección de tarifa, creación de reserva por huésped final, status
   check, cancelación con política. Todos sin JWT, protegidos por
   rate limit + captcha simple en V1.1 si aparece abuso.
3. **Flujo de reserva**: búsqueda → selección → datos huésped +
   consentimientos GDPR → pago Stripe (PaymentIntent o SetupIntent
   según política del hotel) → confirmación con código de reserva.
4. **Email de confirmación** (texto + HTML mínimo) al huésped y al
   front desk del hotel. Sin diseño elaborado V1 — funcional.
5. **Página "Gestionar mi reserva"** con el código + email: ver
   detalles, política, cancelar si aplica.
6. **Multidivisa** EUR/USD/GBP (PROJECT.md §3). Multilanguage solo
   ES/EN V1.
7. **Tests**: e2e Playwright del flujo completo (search → book →
   confirm). Unit del servicio de búsqueda pública.
8. **RUNBOOK §20** con setup, dominios, política de captcha/rate-limit
   y troubleshooting.

**Lo que explícitamente NO se entrega:**

- Channel Manager (push avail/rates a Booking.com/Expedia). Sprint 9.
- Métricas comerciales (conversion funnel) más allá de logs básicos.
  Mejora cuando haya tráfico real.
- Modelo CV local del HSK (Sprint 7 W3 sigue con Claude Vision).
- Onboarding wizard self-service. Sprint 9.
- Pasarela alternativa a Stripe.
- Loyalty / promo codes / corporate booking. V2.
- Pagos en moneda no-default del hotel (multidivisa V2 — V1 muestra
  pero cobra en moneda del property).
- Memoria semántica V1.1 (pgvector + openai) — bloqueada por aprobación
  de dep.

---

## 1. Workstreams

```
┌──────────────────────────────────────────────────────────────────────┐
│  W1 — API pública IBE                                                │
│   - GET  /public/properties/:code (metadata)                         │
│   - GET  /public/availability?code=&arrival=&departure=&pax=         │
│   - POST /public/reservations (crea reservation + folio + guest)     │
│   - GET  /public/reservations/:code?lastName=                        │
│   - POST /public/reservations/:code/cancel                           │
│   - Rate limit por IP + tenant slug                                  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W2 — App web-ibe (Next.js 15)                                       │
│   - apps/web-ibe                                                     │
│   - Routing por property (slug en URL: /h/<slug>/...)                │
│   - Buscador (fechas, PAX, código promo opcional)                    │
│   - Listado de tipos disponibles con tarifa                          │
│   - i18n ES/EN, mobile-first, schema.org markup                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W3 — Reservation + payment flow                                     │
│   - Página /h/<slug>/book (datos huésped + consentimientos GDPR)     │
│   - Integración Stripe Elements para PaymentIntent on-session        │
│   - Confirmación + email (texto + HTML mínimo)                       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W4 — Manage my reservation                                          │
│   - /h/<slug>/manage?code=&lastName=                                  │
│   - Ver detalles, política de cancelación, cancelar                  │
│   - Reenvío de email de confirmación                                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios mantenidos sin excepción:**

- ADR-020: las cancelaciones del huésped van a un flujo público pero
  con verificación (código + apellido) y política aplicada server-side.
  Cargos por penalización se proponen, no se ejecutan, hasta que el
  hotel decide.
- Multi-tenant by default: cada property es un tenant slug en la URL.
- GDPR: consentimientos explícitos en el form. PII guardada en cardex
  con `gdprConsent = true` y `marketingConsent` opcional.
- Multi-tenant: una sola app `web-ibe` sirve todos los properties; el
  routing por slug discrimina.

---

## 2. Workstream 1 — API pública IBE

### 2.1 Property descriptor

`GET /public/properties/:slug` — devuelve la metadata pública del
property: nombre, ciudad, descripción, divisa, rangos típicos de
precio, fotos (cuando exista catálogo de imágenes — V1 placeholder).
No expone tenantId al cliente — el slug es opaco.

### 2.2 Búsqueda de disponibilidad

`GET /public/availability` con query:
```
slug=hotel-berenjena
arrival=2026-07-15
departure=2026-07-18
adults=2
children=0
```

Devuelve, por room type, `{ code, name, available, totalForStay,
pricePerNight, currency, maxOccupancy, restrictions: { mlos, cta, ctd } }`.
Reusa la consulta interna `search_availability_by_type` pero sin
auth y filtrando solo public rate plans.

### 2.3 Crear reserva pública

`POST /public/reservations` con body:
```
{
  slug, arrival, departure, roomTypeId, ratePlanId,
  occupancy: { adults, children },
  guest: { firstName, lastName, email, phone, documentType?, documentNumber?, nationality?, gdprConsent: true, marketingConsent: bool },
  payment: { stripePaymentMethodId? } | { skip: true } // skip = el hotel exige pago al llegar
}
```

Crea Reservation con `source = DIRECT`, `status = CONFIRMED`, genera
`code`, asocia/crea Guest, crea Folio. Si `stripePaymentMethodId`,
tokeniza la tarjeta (reusa SetupIntent flow) — V1 NO captura pago
on-session, solo guarantee.

Email de confirmación encolado a NATS (`email.send` v1, dispatcher en
Sprint 9 si no existe — V1 logue al menos).

### 2.4 Status y cancelación

- `GET /public/reservations/:code?lastName=` — devuelve el detalle
  público (sin folio interno) si `code + lastName` coinciden.
  Verificación simple, sin token. Rate-limit fuerte.
- `POST /public/reservations/:code/cancel` — aplica
  `CancellationPolicy` server-side, devuelve si la penalización aplica
  (texto explicativo) y marca `status = CANCELLED`.

### 2.5 Rate limit + abuse

`@nestjs/throttler` (V1) por IP + slug. Límites:
- availability: 30 req/min/IP
- create reservation: 5/hora/IP
- status/cancel: 20/min/IP/code

Si en piloto aparece scraping serio, añadir Cloudflare Turnstile en el
front. V1 no introduce captcha por defecto.

---

## 3. Workstream 2 — App web-ibe

### 3.1 Routing

```
/ ?slug=hotel-berenjena     → /h/hotel-berenjena
/h/<slug>                   → home del property (descripción + buscador)
/h/<slug>/availability      → resultados (cuando hay query)
/h/<slug>/book              → formulario huésped + pago
/h/<slug>/confirmation/:code → confirmación post-reserva
/h/<slug>/manage            → buscar reserva por code + apellido
```

### 3.2 Tech

- Next.js 15, App Router, RSC por defecto.
- Tailwind con el design system `aubergine-*` reusado.
- `next-intl` o equivalente para ES/EN (V1 strings literales con un
  diccionario simple si añadir lib es scope deviation).
- Schema.org markup `Hotel` + `LodgingReservation` en `<head>` para
  SEO.

### 3.3 Mobile-first

- ≥80% del tráfico real será mobile. Diseñamos primero a 360px de
  ancho.
- CTA principal "Reservar" siempre visible (sticky bottom en mobile).

---

## 4. Workstream 3 — Booking flow + payment

### 4.1 Página `/h/<slug>/book`

Form server action que postea a `POST /public/reservations`. Campos:

- Llegada / salida (preselected del query)
- Tipo de habitación + tarifa (preselected o seleccionable)
- Datos huésped: nombre, apellido, email, teléfono
- Documento (opcional V1, requerido en Sprint 9 cuando SES.HOSPEDAJES
  esté activo en IBE)
- Consentimientos GDPR (gdprConsent obligatorio, marketingConsent
  opcional, ambos persistidos)

### 4.2 Pago

- Stripe Elements integrado on-session (no off-session porque el
  huésped está delante). PaymentIntent V2 — V1 hace SetupIntent y deja
  el cargo al check-in (mismo flujo que back-office).
- Si el hotel exige prepago (configurable en property), entonces
  PaymentIntent on-session con confirm immediate.

### 4.3 Confirmación

`/h/<slug>/confirmation/:code` muestra resumen + código. Email enviado
al huésped y al front desk (vía NATS event `reservation.created` que
ya existe — añadir consumer email en Sprint 9 si no existe; V1 deja
log y un endpoint de "reenviar email" stub).

---

## 5. Workstream 4 — Manage my reservation

### 5.1 Búsqueda

`/h/<slug>/manage` con form (code + apellido). Server action llama
`GET /public/reservations/:code?lastName=`.

### 5.2 Vista

Muestra:
- Llegada / salida / nº noches / tipo / total
- Estado actual (CONFIRMED / CHECKED_IN / CHECKED_OUT / CANCELLED)
- Política de cancelación aplicable: "Cancela gratis antes del
  YYYY-MM-DD" o "No reembolsable".
- Botón "Cancelar reserva" (solo si la política lo permite o si el
  huésped acepta la penalización).
- Botón "Reenviar email de confirmación".

### 5.3 Cancelación

POST al endpoint, muestra resultado con el monto retenido si aplica.
Sin cobro automatizado V1 — el hotel ejecuta el cargo desde back-office
con Stripe Fase 2 si procede.

---

## 6. Datos y migraciones nuevas

Idealmente cero migraciones. Reusamos:
- `properties` (gana `slug` único si no existe — V1 a verificar antes
  de migrar).
- `cancellation_policies` (existe desde Corte A reservations).
- `guests`, `reservations`, `folios`.

**Posible migración mínima:** `properties.slug` unique index si no
existe ya. Y un campo `is_published` en property para que el slug se
exponga solo cuando el hotel lo apruebe (control de privacidad).

---

## 7. Orden de ejecución sugerido

1. **W1 API pública** — desbloquea todos los demás.
2. **W2 App skeleton** — search-only end-to-end.
3. **W3 Booking flow + payment** — el corazón del IBE.
4. **W4 Manage** — cerramos el ciclo huésped.

---

## 8. Salida de Sprint 8 (handoff a Sprint 9)

Si los 4 workstreams cierran, Sprint 8 deja Aubergine con venta directa
funcional. **Sprint 9 arrancará con:**

- Channel Manager (push avail/rates a Booking.com / Expedia vía
  SiteMinder, RoomCloud o equivalente).
- Email service real (SendGrid o Postmark) con plantillas
  multidioma. V1 deja logs/eventos.
- Onboarding wizard self-service (un hotel puede registrarse y
  configurarse sin operador Aubergine).
- Promo codes + corporate booking (auth con código).
- Multidivisa en pago (no solo display).
- Captcha si hay abuso real en piloto.
- Memoria semántica V1.1 (pgvector + openai) si el PO aprueba la dep.
