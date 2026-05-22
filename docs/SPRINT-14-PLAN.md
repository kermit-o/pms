# Sprint 14 — Plan tentativo

> **Versión:** 1.0 — 2026-05-22
> **Branches a mergear primero:** ver §1.
> **Predecesores:** Sprint 13 (rate plans, onboarding polish, Copilot
> rebuild completo).
> **Status del documento:** propuesta, espera aprobación del PO antes
> de iniciar workstreams.

---

## 0. Norte estratégico

La pila Copilot quedó **completa** tras Sprint 13 — 6 widgets, audit
admin, persistencia total. El próximo norte es **cerrar el ciclo
comercial del piloto**: facturación SaaS al hotel, e-invoicing legal
para el huésped, y un par de huecos operativos que el piloto ha
identificado.

Tres bloques propuestos. Orden por **valor + bloqueo**:

1. **Stripe Billing al tenant** — sin esto no facturamos el SaaS.
2. **Verifactu / e-invoicing del hotel al huésped** — legal Spain
   2026, plazo real.
3. **2º channel manager (Cloudbeds o RoomCloud)** — sólo si primer
   piloto lo pide; lo dejo en `[deferred]`.

**Out of scope (NO proponer, NO empezar):**

- Memoria semántica V1.1 (sigue bloqueada por dep `openai` —
  necesita ADR de provider alternativo).
- Multidivisa real (V2).
- White-label CSS custom (V2).
- Loyalty / promo codes (V2).
- Auditoría SOC 2.
- Multi-property en single tenant.

---

## 1. Pre-requisito: mergear S13

Sprint 13 entregó 17 branches en cadena que viven en `origin/`. Antes
de empezar S14, el PO debe mergear (orden recomendado):

```
# Bloque pre-Copilot (independientes entre sí, pueden mergearse en orden)
s13-w1-rate-plans-nonrefundable
s13-w2-rate-plans-admin-ui-from-w1
s13-w3-onboarding-polish

# Bloque Copilot — orden ESTRICTO por dependencias
hotfix-copilot-error-handling                # independiente
copilot-block-hallucinations                 # independiente
copilot-widgets-availability                 # sobre main
copilot-widgets-persistence
copilot-widget-folio
copilot-widget-reservation-summary
copilot-session-reload-from-db
copilot-widget-hsk-tasks
copilot-widgets-shared-types
copilot-admin-sessions
copilot-admin-sessions-filters
copilot-admin-user-selector
copilot-admin-csv-export
copilot-widget-arrivals-departures
copilot-widget-suggest-assignments
copilot-persist-session-property
copilot-persist-pending-tools
copilot-admin-nav-link
```

Tras merge: `flyctl deploy` de `pms-api` + `pms-web-fo`. Hay 4
migraciones nuevas (`rate_plan_non_refundable`,
`copilot_message_widgets`, `copilot_sessions`,
`copilot_pending_tools`) — `prisma migrate deploy` las aplica
forward-only en orden, todas retro-compatibles.

---

## 2. Workstream 1 — Stripe Billing al tenant

### 2.1 Por qué

Hoy cobramos al huésped vía Stripe (Sprint 11/12 W3). Pero al hotel
**no le cobramos nada por usar Aubergine**. Sin Billing del SaaS no
hay modelo de negocio cerrado para escalar más allá del primer
piloto.

### 2.2 Alcance V1

- Stripe Billing como motor (mismo Customer pero scope distinto).
- Un único plan inicial: "Aubergine PMS — boutique" con precio
  fijo + per-room (e.g. base 99€/mes + 3€/room/mes). Configurable
  en Stripe Dashboard, lectura via `subscription.metadata`.
- Estado de suscripción persistido en `tenants` (nuevas columnas
  `stripe_customer_id`, `stripe_subscription_id`,
  `subscription_status`, `current_period_end`).
- Webhook handler nuevo en `apps/api/src/billing/`:
  `subscription.created`, `subscription.updated`,
  `subscription.deleted`, `invoice.payment_failed`.
- Endpoint `GET /me/subscription` para el back-office (lee el
  status y vencimiento).
- Página `/admin/billing` con resumen + portal link
  (Stripe-hosted Customer Portal, sin reimplementar gestión).
- Gate básico: cuando `subscription_status === 'past_due' || 'canceled'`,
  banner persistente en el back-office (no bloquea operación V1).
  Bloqueo agresivo es V2.

### 2.3 Migraciones

| Migración | Contenido |
|---|---|
| `20260710_tenant_billing` | `tenants.stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (text + check), `current_period_end` |

### 2.4 Decisiones a tomar con el PO

- **Precio exacto** del plan (base + per-room).
- **Trial gratuito** ¿14, 30, 60 días?
- **Comportamiento past_due**: V1 sólo banner; V2 grace-period 7d
  → degradación → bloqueo.
- **Cobro inicial**: ¿inmediato al onboarding o tras trial?

### 2.5 Sprint count tentativo

3-4 días (1 día schema + webhook + portal; 1 día UI admin; 1 día
edge cases + tests).

---

## 3. Workstream 2 — Verifactu / e-invoicing

### 3.1 Por qué

Plazo Verifactu en España (RD 1007/2023): los autónomos y empresas
del régimen general deben emitir facturas con sistema "verificable"
por la AEAT desde **1 julio 2026** (estimado, depende del rango de
ingresos). Los hoteles entran. Si Aubergine no emite Verifactu-compliant,
el hotel piloto tendrá que usar otro sistema en paralelo para
facturas — friction crítica.

### 3.2 Alcance V1

- Nueva tabla `invoices` con campos requeridos por Verifactu
  (número correlativo, fecha emisión, NIF/CIF emisor + receptor,
  base imponible, IVA, total, descripción, hash encadenado del
  registro anterior, código QR / código de identificación).
- Generador de facturas a partir del folio al `checkout` o al
  `addCharge` con bandera `issueInvoice=true`.
- Endpoint Verifactu (REST de AEAT) — autenticación con certificado
  digital del tenant. Requiere config por hotel (subir certificado).
- Cola NATS `invoice.submit_requested` para reintentos.
- PDF de la factura con QR Verifactu para entregar al huésped
  (Puppeteer — ya pendiente ADR).
- Página `/billing/invoices` para listar y reimprimir.

### 3.3 Decisiones a tomar con el PO

- **ADR puppeteer** (ya pendiente desde Sprint 12 plan §1 «Lo
  que no se entrega»). Sin puppeteer el PDF lo emitimos como
  HTML imprimible (downgrade).
- **Certificado digital**: el hotel lo sube al onboarding o más
  tarde. UI de upload + storage seguro (Fly volume cifrado o
  HashiCorp Vault).
- **Modo "no Verifactu" para tests**: stub local que valida
  estructura sin tocar AEAT.
- **Fallback en caída AEAT**: factura emitida + estado `PENDING_SUBMIT`,
  reintento periódico.

### 3.4 Migraciones

| Migración | Contenido |
|---|---|
| `20260712_invoices` | tabla `invoices` (col completa), `invoice_submissions` para audit AEAT |

### 3.5 Sprint count tentativo

5-7 días. Es el más grande y el de mayor riesgo (integración con AEAT,
crypto del certificado, hash chaining correcto). Trabajar con
documentación AEAT y un canario antes de cualquier piloto live.

---

## 4. Workstream 3 — 2º channel manager `[deferred]`

### 4.1 Por qué deferred

SiteMinder ya está integrado (Sprint 9 W2). Añadir Cloudbeds o
RoomCloud sólo si el primer piloto trae OTAs que SiteMinder no
maneja bien. **Decisión: esperar feedback del piloto** post-merge
S13.

Si se aprueba, el patrón es el mismo (Sprint 9 W2 lo dejó
extensible). ~3 días por provider nuevo.

---

## 5. Workstreams candidatos secundarios

Si los tres principales avanzan rápido o uno se bloquea (típicamente
W2 por Verifactu), hay candidatos chicos en backlog:

- **Bloqueo billing past_due agresivo** (~2 días, V2 de W1).
- **Reports PDF + scheduling** (~5 días, ADR puppeteer compartida
  con W2).
- **Calendar mejoras** (drag de fechas — resize horizontal). Sprint
  12 W4 lo dejó como pendiente.
- **Vista admin /admin/copilot** con dashboard (no sólo lista de
  sesiones): tokens consumidos por modelo/mes, top tools usadas,
  ratio de pending tools rechazados vs aprobados. ~3 días, aprovecha
  toda la persistencia del Sprint 13.
- **Widget `forecast_demand`** del Copilot (extensión del cuarteto
  Mockup B). ~1 día.

---

## 6. Lo que NO se entrega en S14

- **Reescritura del Copilot a streaming** (los slices futuros vienen
  cuando el feedback diga que latency es un problema).
- **GraphQL** (la API REST cumple; cambios sólo con ADR).
- **Migrar de Postgres** (RLS funciona bien; no hay justificación).
- **Refactor monolito → micro** (CLAUDE.md §1, requiere ADR).

---

## 7. Orden sugerido para empezar

1. **PO mergea S13** (orden de §1).
2. **PO decide W1 + W2** (precio, trial, ADR puppeteer, modo
   Verifactu test).
3. **Claude Code abre W1** (`claude/s14-w1-stripe-billing`).
4. **Claude Code abre W2 en paralelo** una vez ADR puppeteer está
   aprobada (`claude/s14-w2-verifactu`).
5. **W3 queda pausado** hasta feedback del piloto.

---

## 8. Riesgos

- **W2 Verifactu** es alto riesgo: dependencia externa (AEAT),
  crypto correcto, hash chaining sin bugs. Sugiero **iterar con un
  hotel piloto de bajo volumen** primero.
- **Billing past_due UX**: cobrar dinero al hotel cambia la
  relación cliente. Banner es safe; bloqueo es agresivo. Empezar
  por banner.
- **Coste de Stripe** del lado del SaaS: ~2.9% + 0.30€ por charge.
  Para suscripciones recurrentes sí compensa el coste de Stripe vs
  desarrollar billing propio.

---

_Última actualización: 2026-05-22 (Claude Code)._
