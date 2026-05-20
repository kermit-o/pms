# Sprint 10 — Consolidación pre-piloto

> **Versión:** 1.0 — 2026-05-19
> **Branch del plan:** `claude/s10-plan`. Workstreams en `claude/s10-w<N>-<topic>`.
> **Documento padre:** Sprint 9 §8 (handoff) + PROJECT.md §4.4.
> **Predecesores:** Sprint 9 cerrado en código (W1 Email, W4 Anti-abuso,
> W3 Onboarding, W2 Channel Manager).

---

## 0. Norte estratégico

Sprint 9 entregó las cuatro patas que el IBE+CM+onboarding necesitan
para que un hotel se encienda solo. **Sprint 10 cierra los gaps V1
restantes** antes de invitar al primer hotel piloto. Filosofía: nada
nuevo, todo más sólido.

Cuatro bloques:

1. **Auto-Keycloak en onboarding** — cierra el único paso manual que
   quedó en S9 W3. Hoy un hotel puede registrarse desde el wizard pero
   sus credenciales tienen que crearlas a mano en Keycloak. Sprint 10
   lo automatiza vía Keycloak admin API (REST, sin dep npm).
2. **Fix tests preexistentes** — Decimal mock en
   `reservations.service.spec` y fechas hardcoded en
   `business-day.service.spec`. 4 fallos arrastrados desde Sprint 7.
   Limpiar la deuda antes de meter más volumen.
3. **Cleanup nightly de tenants huérfanos** — RUNBOOK §23.7 dejó el
   SQL. Sprint 10 lo convierte en un step del Night Audit o un job
   separado, idempotente.
4. **Back-office admin UI para los gaps de S9** — el operador del
   hotel necesita poder en la UI:
   - publicar/despublicar el IBE (`property.publishedAt` toggle),
   - configurar el channel manager (provider + ids),
   - gestionar IPs bloqueadas (`property.attributes.blockedIps`).
   Hoy todo se hace por SQL — frágil y no operable por el hotel.

**Definition of Done de Sprint 10:**

1. **Auto-Keycloak**: `POST /public/onboarding/setup` crea el realm
   `pms-<slug>`, los clients (`pms-api`, `pms-fo`, `pms-ibe`) y el
   admin user con password temporal; la respuesta del wizard devuelve
   ya las credenciales. Si Keycloak admin API no está disponible,
   fallback al modo manual (logueado para que el equipo intervenga).
2. **Tests verdes en CI**: `pnpm --filter @pms/api test` pasa 100%.
3. **Cleanup job**: un nuevo step `CLEANUP_ORPHAN_TENANTS` en NA
   marca como deleted los `pending-*` con > 7 días. Idempotente,
   metrica + log estructurado. Configurable via env.
4. **Back-office admin UI**: en `/properties/<id>/settings` el
   operador ve y modifica los tres bloques (IBE publish toggle, CM
   config, blocked IPs). Permisos: solo roles `OWNER` / `MANAGER`.

**Lo que NO se entrega:**

- Memoria semántica V1.1 (sigue bloqueada por dep `openai`).
- 2º channel manager provider (Cloudbeds/RoomCloud) — Sprint 11 si
  primer piloto lo pide.
- Multidivisa real (V2 — display ya funciona).
- White-label subdominio + CSS custom.
- Loyalty / promo codes.
- Auditoría SOC 2.
- Pre-pago full PaymentIntent on-session (el modelo actual con
  SetupIntent + cobro on-arrival cubre el piloto).

---

## 1. Workstreams

```
┌──────────────────────────────────────────────────────────────────────┐
│  W1 — Auto-Keycloak en onboarding                                    │
│   - apps/api/src/auth/keycloak-admin.service.ts                      │
│   - Reusa el setup paso del wizard para llamar al admin API.         │
│   - Fallback graceful si Keycloak no disponible.                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W2 — Fix tests preexistentes                                        │
│   - Decimal mock en reservations.service.spec                        │
│   - Fechas relativas en business-day.service.spec                    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W3 — Cleanup tenants pending vía NA                                 │
│   - night-audit/steps/cleanup-orphan-tenants.ts                      │
│   - Idempotente, soft-delete, métrica                                │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W4 — Back-office admin UI                                           │
│   - /properties/[id]/settings con tres pestañas                      │
│   - Endpoints API en properties module                               │
│   - Guard por rol OWNER/MANAGER                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios mantenidos:**

- ADR-020/023/024 vigentes.
- Multi-tenant by default.
- Sin SDKs externas cuando un fetch REST basta (Keycloak admin
  cumple).
- Cualquier dep nueva → ADR + aprobación PO.

---

## 2. Workstream 1 — Auto-Keycloak en onboarding

### 2.1 Modelo

Sin migración nueva. El servicio nuevo `KeycloakAdminService`
encapsula las llamadas al admin REST.

### 2.2 Servicio

`apps/api/src/auth/keycloak-admin.service.ts`:

- `obtainAdminToken()` — `POST /realms/master/protocol/openid-connect/token`
  con client_credentials (KEYCLOAK_ADMIN_CLIENT_ID + SECRET).
- `createRealm(slug)` — `POST /admin/realms` body `{ realm, enabled }`.
- `createClient(realm, clientId, redirectUris)` — `POST /admin/realms/{realm}/clients`.
- `createUser(realm, email, fullName, temporaryPassword)` — `POST /admin/realms/{realm}/users`.
- `resetUserPassword(realm, userId, password, temporary)`.

Todo HTTPS REST. Token cache en memoria (TTL 60s — el admin token
caduca a los 60min pero refrescarlo cada minuto es trivial).

### 2.3 Wire en wizard

`PublicOnboardingService.setup` orquesta tras crear tenant+property:

1. Llama a `KeycloakAdminService.createRealm(tenant.slug)`.
2. Crea client `pms-api` (público, used by JWT validator),
   `pms-fo` (web-fo client, OIDC), `pms-ibe` (placeholder).
3. Crea user admin con `temporary=true` para forzar cambio en primer
   login.
4. Si **cualquier** paso de Keycloak falla, captura el error, marca
   `tenant.onboarding_status='SETUP_DONE_KEYCLOAK_PENDING'` y devuelve
   las credenciales en modo "manual fallback" + warning en logs.

### 2.4 Env nuevos

```
KEYCLOAK_ADMIN_BASE_URL — default igual a KEYCLOAK_URL si está
KEYCLOAK_ADMIN_CLIENT_ID — client en realm master con admin role
KEYCLOAK_ADMIN_CLIENT_SECRET — secret del client admin
```

Sin estos vars, el fallback manual sigue siendo el comportamiento V1.

### 2.5 Tests

- `keycloak-admin.service.spec.ts` con mock de `fetch`.
- Update `public-onboarding.service.spec.ts` con mock del
  KeycloakAdminService.

---

## 3. Workstream 2 — Fix tests preexistentes

### 3.1 Reservations Decimal mock

`reservations.service.ts:1694` hace `new Prisma.Decimal(roomTypeDefaultRate)`
y los tests pasan `roomType: undefined.defaultRate`. Fix: el mock
debe poner `defaultRate: 100` en el roomType findFirst stub.

### 3.2 Business-day fechas hardcoded

Los tests usan `'2026-06-10'` como businessDate pero en el momento de
ejecución la fecha ya es `2026-05-19` (próxima). El test falla porque
la lógica rechaza fechas futuras. Fix: usar `today` (computado al
arrancar el test) o congelar `vi.useFakeTimers()`.

### 3.3 Pipeline

Run completo `pnpm --filter @pms/api test` debe pasar 100% antes de
merge.

---

## 4. Workstream 3 — Cleanup tenants pending vía NA

### 4.1 Step nuevo

`apps/api/src/night-audit/steps/cleanup-orphan-tenants.ts`:

- SELECT tenants `onboarding_status = 'EMAIL_VERIFIED'` AND `slug LIKE 'pending-%'`
  AND `created_at < NOW() - INTERVAL '7 days'`.
- Soft-delete: `UPDATE tenants SET deleted_at = NOW()`.
- Devuelve `{ deleted: N }` en `totals`.

### 4.2 Pipeline

Añadirlo al final del pipeline NA, **después** de CLOSE_DAY (la
limpieza no es operacional, no afecta al cierre del día).

### 4.3 Test

`cleanup-orphan-tenants.spec.ts` con mock de tenant.findMany +
tenant.update.

### 4.4 Métricas

`night_audit_orphan_tenants_deleted_total` (counter, sin labels —
volumen es bajo).

---

## 5. Workstream 4 — Back-office admin UI

### 5.1 API endpoints

En `apps/api/src/properties/properties.controller.ts`:

- `PUT /properties/:id/publish` — body `{ publish: boolean }` setea
  `publishedAt` a `now()` o `null`. Genera `public_slug` si falta.
- `PUT /properties/:id/channel-manager` — body
  `{ provider, propertyId, credentialsRef }`. Solo OWNER/MANAGER.
- `PUT /properties/:id/blocked-ips` — body `{ ips: string[] }` setea
  `attributes.blockedIps`.

### 5.2 Páginas web-fo

`apps/web-fo/src/app/properties/[id]/settings/page.tsx` con tres
secciones (no tabs — flujo lineal con anclas).

Form actions server-side que llaman al API.

### 5.3 Permisos

Reusar el guard de roles existente (Keycloak roles). En el endpoint:
`@Roles('OWNER', 'MANAGER')`.

### 5.4 Tests

- Smoke test del controller (mock service).
- `properties.service.spec.ts` con happy path por cada endpoint nuevo.

---

## 6. Datos y migraciones nuevas

| Migración | Contenido |
|-----------|-----------|
| — | W1 no necesita migración. |
| — | W2 no toca DB. |
| — | W3 reusa columnas existentes (`tenants.deleted_at`, `onboarding_status`). |
| — | W4 reusa columnas que ya añadió S9 (`properties.attributes`, etc.). |

Sprint 10 es 100% código + UI — cero migraciones.

---

## 7. Orden de ejecución sugerido

1. **W2 Fix tests preexistentes** — libera el CI verde, ~1h.
2. **W1 Auto-Keycloak** — cierra el último gap manual del wizard.
3. **W3 Cleanup vía NA** — depende de W2 (NA test suite limpio).
4. **W4 Back-office admin UI** — el más visual; se beneficia de
   tener W1 cerrado (la UI puede mostrar el estado real del realm).

---

## 8. Salida de Sprint 10 (handoff a Sprint 11)

Si los 4 cierran:

- Aubergine está operable extremo-a-extremo sin operador nuestro.
- CI 100% verde.
- El hotel maneja su propia configuración de IBE + CM + IPs
  bloqueadas desde el back-office.
- Cleanup automático de tenants huérfanos cada noche.

**Sprint 11 arrancará con:**

- Memoria semántica V1.1 (si PO aprueba `openai`).
- 2º channel manager provider (Cloudbeds / RoomCloud) cuando el
  primer piloto lo pida.
- Pre-pago full PaymentIntent on-session (alternativa al SetupIntent).
- Multidivisa real (V2 scope).
- White-label subdominio + CSS custom.
- Loyalty / promo codes.
- Auditoría SOC 2 cuando el cliente lo exija.

GTM (PROJECT.md §10 fase 7) sigue en paralelo, fuera de scope Claude.
