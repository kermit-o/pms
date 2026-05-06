# Aubergine — PMS SaaS · Documento Maestro del Proyecto

> **Producto:** Aubergine — AI-native PMS para hoteles boutique en España (30-150 habs).
> **Repo:** `kermit-o/pms` (el codename interno se mantiene; la marca pública es Aubergine).

> **Este documento es la fuente única de verdad del proyecto.**
> Antes de iniciar cualquier sesión de trabajo, leerlo.
> Antes de cambiar el rumbo, actualizarlo aquí primero.
> Si una conversación contradice este archivo, gana este archivo (salvo que se actualice explícitamente).

---

## 0. Estado actual

- **Sprint 1 (Foundation) ✅ mergeado a `main` (PR #2).** NestJS API + Prisma RLS + Keycloak/JWT + NATS eventbus + MCP server + OpenTelemetry. Plan en [`docs/SPRINT-1-PLAN.md`](./docs/SPRINT-1-PLAN.md).
- **Sprint 1.5 (Polish) ✅ mergeado a `main` (PR #2).** CI verde, lockfile, RUNBOOK, discovery doc. Plan en [`docs/SPRINT-1.5-PLAN.md`](./docs/SPRINT-1.5-PLAN.md).
- **Sprint 2 pre-work ✅ mergeado a `main` (PR #3).** Modelo de datos canónico FO: `RoomType`, `Room`, `Guest`, `RatePlan`, `Reservation`, `ReservationGuest`, `Folio`, `FolioEntry`, con RLS + audit triggers + seed. Plan en [`docs/SPRINT-2-PREP.md`](./docs/SPRINT-2-PREP.md).
- **Sprint 1.5 staging ✅ mergeado a `main` (PR #4).** Dockerfile multi-stage + Railway compatibility. Validado end-to-end en Railway: Keycloak → JWT con `tenant_id` → API → `withTenant` → RLS.
- **Sprint 1.5 RUNBOOK Railway ✅ mergeado a `main` (PR #5).** Sección 12 con 7 lecciones aprendidas del despliegue.
- **Sprint 2 (MVP FO completo) ✅ mergeado a `main` (PR #6).** Producto: **Aubergine**. Alcance per §4.1 íntegro: reservas CRUD/walk-in/group bookings, check-in/out, folio con cargos/pagos/close + idempotencia, cardex GDPR, rooms availability matrix, business-day locking, SES.HOSPEDAJES sender con retries + DLQ. UI Next.js 15 con 19 rutas (login OIDC, dashboard, calendar, reservations, guests, rooms, business-day, compliance/ses) + copiloto conversacional con MCP tools y confirmación humana (ADR-020). 89/89 unit tests + 5 Playwright smoke specs. Plan en [`docs/SPRINT-2-PLAN.md`](./docs/SPRINT-2-PLAN.md).
- **Fase actual: Sprint 3 — MVP Night Audit (sin recortes).** Alcance per §4.2 íntegro: cierre diario con post de room charges + taxes + packages, roll-over de fecha de negocio, no-shows automáticos, reportes (Manager / In-house / Arrivals-Departures / Revenue / Tax), reconciliación de cajas, locking inmutable del día cerrado. Plan en [`docs/SPRINT-3-PLAN.md`](./docs/SPRINT-3-PLAN.md).
- **Branch de desarrollo actual:** `claude/sprint-3-night-audit`.
- **Última actualización:** 2026-05-06

---

## 1. Visión

Construir **Aubergine** — un **PMS (Property Management System) SaaS AI-native** para hoteles, que compita con Opera Cloud, Mews, Cloudbeds y Apaleo en los flancos donde son débiles: **UX, precio, API-first y agentes de IA integrados**.

**Tagline interno:** _"AI-native PMS"_ — no es un PMS con IA pegada encima, sino un PMS diseñado alrededor de la IA desde el día uno.

### Por qué ahora

Las grandes cadenas (Marriott, Accor, IHG) ya están pilotando IA en operaciones. Hay una ventana de **18-24 meses** antes de que el mercado se sature. Los PMS legacy no pueden adaptarse rápido por arrastrar arquitecturas de hace 20 años.

---

## 2. Objetivo

Posicionarnos como una de las primeras opciones para hoteles independientes y boutique que adopten IA en operaciones, con un MVP enfocado en los tres módulos críticos:

1. **Front Office (FO)** — recepción, reservas, check-in/out, folio.
2. **Night Audit (NA)** — cierre diario, reportes, auditoría continua.
3. **Housekeeping (HSK)** — estado de habitaciones, asignación de tareas, mobile-first.

El MVP debe ser **usable en un hotel real** — no una demo.

---

## 3. Mercado objetivo (cerrado 2026-05-04)

| Decisión                 | Estado | Valor                                                      |
| ------------------------ | ------ | ---------------------------------------------------------- |
| Tamaño hotel             | ✅     | Boutique e independiente, **30-150 habitaciones**          |
| Geografía inicial        | ✅     | **España** (GDPR + SES.HOSPEDAJES + factura electrónica)   |
| Single vs multi-property | ✅     | **Single-property** en MVP, multi-property en V2 (mes 8-9) |
| Idiomas MVP              | ✅     | **ES + EN** desde día 1                                    |
| Multi-divisa             | ✅     | **EUR + USD + GBP** desde día 1                            |
| API-first / terceros     | ✅     | **Sí** — diferenciador clave, expuesto vía REST + MCP      |

---

## 4. Alcance del MVP

### 4.1 Front Office (FO)

- Reservas: CRUD, walk-in, group bookings.
- Check-in / Check-out.
- Asignación y cambio de habitación.
- Folio: cargos manuales, pagos parciales, splits.
- Tarjeta de registro y compliance (SES.HOSPEDAJES en España).
- Cardex de huéspedes (datos personales, GDPR-compliant).

### 4.2 Night Audit (NA)

- Cierre diario: post de room charges, taxes, packages.
- Roll-over de fecha de negocio.
- No-shows automáticos.
- Reportes: Manager Report, In-house, Arrivals/Departures, Revenue, Tax.
- Reconciliación de cajas.
- Locking del día cerrado (inmutable).

### 4.3 Housekeeping (HSK)

- Estados: Clean / Dirty / Inspected / Out-of-Order / Out-of-Service.
- Asignación de tareas a camareras.
- Discrepancies (sleep / skip / sleeper).
- Lost & Found.
- **Mobile-first** (PWA) — las camareras usan móvil, no PC.

### 4.4 Fuera de alcance del MVP (roadmap futuro)

- Channel Manager (se integrará con SiteMinder/Cloudbeds/D-Edge).
- Revenue Management (integración Duetto/IDeaS).
- POS de F&B (integración Micros/Lightspeed).
- Contabilidad (export a SAP/A3).
- Booking engine propio.
- Loyalty program.

---

## 5. Decisión arquitectural: SaaS multi-tenant

**Decisión tomada:** SaaS multi-tenant con `tenant_id` en cada tabla + Row-Level Security (Postgres RLS).

**Razón:** es el modelo que usan Mews y Apaleo. Permite escalar de 1 a 1000+ hoteles sin reescribir. Updates centralizados. Costos bajos.

**Aislamiento de datos:** RLS estricta a nivel Postgres + validación a nivel aplicación (defensa en profundidad).

---

## 6. Stack técnico (cerrado 2026-05-04)

| Capa               | Elección                                              |
| ------------------ | ----------------------------------------------------- |
| Backend            | **Node.js 20 LTS + TypeScript + NestJS**              |
| DB                 | **PostgreSQL 16** con Row-Level Security              |
| ORM / migraciones  | **Prisma**                                            |
| Cache / colas      | **Redis + BullMQ**                                    |
| Eventos            | **NATS** (JetStream) — event-driven desde día 1       |
| Frontend FO/NA     | **Next.js 15 + React 19** (desktop)                   |
| Frontend HSK       | **Next.js PWA** (mobile-first)                        |
| Auth               | **Keycloak self-hosted** (sin lock-in, GDPR-friendly) |
| IA / LLM           | **Claude vía Anthropic SDK** como modelo principal    |
| Protocolo de tools | **MCP (Model Context Protocol)**                      |
| Observabilidad     | OpenTelemetry + Grafana + Loki                        |
| Infra (early)      | **Fly.io** o Railway                                  |
| Infra (escala)     | Docker + Kubernetes                                   |
| Monorepo           | **pnpm workspaces** + Turbo                           |
| Testing            | Vitest (unit) + Playwright (e2e)                      |

---

## 7. Estrategia de IA — el verdadero diferenciador

### 7.1 Principio rector

**Toda acción del PMS debe estar expuesta como una `tool` MCP-compatible.** Aunque en el MVP la IA sea modesta, la arquitectura permite añadir agentes en V2/V3 sin reescribir nada. **Ese es el moat.**

### 7.2 Capacidades por módulo

#### FO con IA

- **Agente conversacional operativo**: comandos en lenguaje natural ("upgrade al señor García a la 305, cobra 40€").
- **Pre-check-in autónomo**: parsea emails y prepara la habitación.
- **Voice-to-folio**: cargos por voz.
- **Detección de fraude**: tarjetas robadas, OTAs sospechosas, no-shows predichos.

#### NA con IA — "Auditor virtual"

- **Auditoría continua 24/7** en streaming, no batch nocturno.
- **Anomaly detection**: rate overrides raros, descuentos sospechosos, cargos duplicados.
- **Reportes generativos**: el director pregunta en lenguaje natural, el sistema responde con análisis causal.
- **Forecasting embebido**: pickup, ocupación, ADR, no-shows a 90 días.
- **Auto-reconciliación bancaria**.

#### HSK con IA — mayor ROI tangible

- **Asignación óptima de tareas** (reduce 15-25% tiempo de limpieza).
- **Predicción de tiempo por habitación** según histórico.
- **Visión por computadora** para inspección post-limpieza.
- **Mantenimiento predictivo** cruzando HSK + IoT.
- **Voice-first** para camareras.

### 7.3 Capa transversal de IA (V2+)

- **Copiloto único** que ve todo el hotel.
- **Memoria semántica del huésped** persistente.
- **Agentes especializados en background**: revenue, reputación, upselling, compliance.
- **MCP abierto**: el hotel puede traer su propio LLM y conectarlo.

### 7.4 Privacidad

- Procesamiento local cuando sea posible.
- Modelos open-source (Llama, Mistral) como opción para hoteles paranoicos.
- Datos del huésped nunca salen del tenant sin consentimiento explícito.

---

## 8. Principios arquitecturales (no negociables)

1. **API-first**: cada función accesible vía REST/GraphQL antes que vía UI.
2. **Event-driven**: cada cambio de estado emite un evento (NATS/Kafka).
3. **MCP-first**: cada acción es una tool consumible por agentes.
4. **Multi-tenant by default**: nunca código que asuma un solo hotel.
5. **Mobile-first en HSK**: si no funciona en un móvil de gama media, no se mergea.
6. **Audit log inmutable**: todo cambio queda registrado (compliance + debugging + IA).
7. **Data portability**: el hotel puede exportar todo en cualquier momento. Anti-lock-in.
8. **Privacy by design**: GDPR no es un parche, está en el modelo de datos.
9. **Idempotencia**: toda operación crítica (pagos, NA, eventos) debe ser idempotente.
10. **Feature flags desde día 1** (LaunchDarkly o Unleash self-hosted).

---

## 9. Modelo de negocio

- **Pricing por valor, no por habitación**: cobrar por horas-hombre ahorradas, no PMS pelado.
- Tier base + módulos de IA opcionales (NA virtual, HSK predictivo, copiloto).
- API access incluido (no como upsell, como diferenciador).
- Sin lock-in: export completo de datos en cualquier momento.

---

## 10. Roadmap de alto nivel

| Fase              | Duración  | Objetivo                                                                     |
| ----------------- | --------- | ---------------------------------------------------------------------------- |
| **0. Discovery**  | 2-3 sem   | Cerrar decisiones pendientes (sección 3), validar con 2-3 hoteles.           |
| **1. Foundation** | 1 mes     | Auth, multi-tenancy, modelo de datos base, CI/CD, infra.                     |
| **2. MVP FO**     | 2 meses   | Reservas + check-in/out + folio + cardex.                                    |
| **3. MVP NA**     | 1 mes     | Cierre diario + reportes esenciales.                                         |
| **4. MVP HSK**    | 1 mes     | PWA mobile + estados + asignación.                                           |
| **5. Piloto**     | 1-2 meses | 1-2 hoteles reales en producción.                                            |
| **6. IA V1**      | 2 meses   | Copiloto operativo básico, anomaly detection NA, asignación inteligente HSK. |
| **7. GTM**        | continuo  | Sales, partnerships, expansión geográfica.                                   |

**Total a primer cliente productivo:** ~6 meses con 2-3 devs.

---

## 11. Reglas de trabajo (cómo colaboramos)

1. **Antes de cada sesión:** leer este documento.
2. **Antes de cambiar el rumbo:** actualizar este documento primero.
3. **Decisiones arquitecturales importantes:** se registran en sección 13 (ADR — Architecture Decision Records).
4. **No se añaden features fuera del alcance MVP** sin aprobación explícita y actualización de este doc.
5. **No se introducen abstracciones prematuras**: tres líneas similares es mejor que una abstracción especulativa.
6. **El branch de desarrollo es `claude/plan-hotel-saas-rWaWw`** hasta que se decida lo contrario.
7. **Idioma del código:** inglés (identificadores, comentarios técnicos).
8. **Idioma de documentación de producto y comunicación:** español.

---

## 12. Decisiones pendientes

### Cerradas (2026-05-04)

- [x] Tamaño y tipo de hotel objetivo → boutique 30-150 habs (ver §3).
- [x] Geografía inicial → España (ver §3).
- [x] Single vs multi-property en MVP → single-property (ver §3).
- [x] Idiomas y multi-divisa → ES+EN, EUR+USD+GBP (ver §3).
- [x] Stack final → confirmado (ver §6).

### Abiertas / asunciones pendientes de validar

- [ ] **Equipo / timeline real.** Asunción: 1 dev humano + Claude Code, sin deadline duro, ritmo side-project apuntando al roadmap de 6 meses (§10). Revisar si entran inversores o piloto con fecha.
- [ ] **Validación con 2-3 hoteles reales.** Asunción: Foundation (Sprint 0-1) avanza en paralelo al outreach, pero **antes de cerrar el alcance de Fase 2 (MVP FO)** debemos haber hablado con 2-3 hoteles. Documentado como riesgo en ADR-007.

---

## 13. Architecture Decision Records (ADR)

> Registro cronológico de decisiones arquitecturales. Formato: fecha + decisión + razón + alternativas descartadas.

### ADR-001 — 2026-05-04 — SaaS multi-tenant con Postgres RLS

- **Decisión:** Un único deployment, `tenant_id` en cada tabla, Row-Level Security en Postgres.
- **Razón:** Modelo probado por Mews y Apaleo. Escalable. Updates centralizados.
- **Alternativas descartadas:** schema-per-tenant (no escala >500 tenants), single-tenant (caro).

### ADR-002 — 2026-05-04 — MCP-first / tool-first architecture

- **Decisión:** Cada acción del PMS se expone como una tool MCP-compatible desde el día 1.
- **Razón:** Permite añadir agentes de IA en V2/V3 sin reescribir. Es el moat frente a PMS legacy.
- **Alternativas descartadas:** "añadir IA después" (la deuda arquitectural sería enorme).

### ADR-003 — 2026-05-04 — Event-driven desde el inicio

- **Decisión:** NATS JetStream desde el primer commit. Cada cambio de estado emite evento.
- **Razón:** La IA necesita streams, no requests. Auditoría continua imposible sin eventos.
- **Alternativas descartadas:** Kafka (overkill para 1-1000 hoteles), event sourcing en V2 (cambiar después es muy caro).

### ADR-004 — 2026-05-04 — Mercado inicial: hoteles boutique 30-150 habs en España

- **Decisión:** Hotel independiente / boutique 30-150 habs, geografía España.
- **Razón:** Segmento mal atendido por Opera (caro/complejo) y por Cloudbeds (genérico). GDPR + SES.HOSPEDAJES + factura electrónica son barreras que protegen contra entrantes US.
- **Alternativas descartadas:** cadenas (ciclos de venta de 18 meses), hoteles <30 habs (no pagan), LATAM (fragmentación regulatoria).

### ADR-005 — 2026-05-04 — Single-property en MVP

- **Decisión:** El MVP soporta un hotel por tenant. Multi-property en V2 (mes 8-9).
- **Razón:** Multi-property bien hecho añade ~6 semanas. Casi ningún boutique lo necesita en piloto.
- **Alternativas descartadas:** multi-property desde día 1 (retrasa MVP sin valor para el cliente objetivo).

### ADR-006 — 2026-05-04 — Stack: NestJS + Postgres + Prisma + Next.js + NATS + Keycloak

- **Decisión:** Ver §6 para el detalle completo.
- **Razón:** Stack TypeScript end-to-end (un solo lenguaje), ecosistema maduro, hiring fácil. Prisma para velocidad de desarrollo. Keycloak self-hosted para no atarnos a Auth0/Clerk (GDPR + soberanía de datos). NATS porque Kafka es overkill a esta escala. pnpm + Turbo porque son el estándar actual de monorepos JS.
- **Alternativas descartadas:** Python+FastAPI (dos lenguajes en stack), Auth0/Clerk (lock-in + datos fuera de EU), Kafka (complejidad operativa innecesaria).

### ADR-007 — 2026-05-04 — Foundation arranca en paralelo a la validación con hoteles

- **Decisión:** Sprint 0-1 (scaffolding, infra, multi-tenancy, auth, modelo de datos base) avanza sin esperar al feedback de hoteles. Antes de cerrar el alcance de Fase 2 (MVP FO) hay que haber hablado con 2-3 hoteles.
- **Razón:** Foundation es agnóstica al feature set. Validar antes de Fase 2 evita 2 meses de desarrollo equivocado.
- **Riesgo asumido:** si la validación obliga a cambiar de segmento/geografía, parte del trabajo de §6 podría requerir ajustes (probable: localización fiscal, idiomas adicionales).

### ADR-008 — 2026-05-04 — Doble defensa: RLS + filtro en aplicación

- **Decisión:** Aislamiento multi-tenant aplica en dos capas: (a) Postgres RLS con `FORCE` en tablas operativas (`users`, `properties`), y (b) filtro `tenant_id` explícito en consultas de la app cuando aporta claridad/performance.
- **Razón:** RLS es la última línea de defensa contra bugs en la app. El filtro en código es performance (índices en `tenant_id`) y legibilidad. Si un sólo nivel falla, el otro contiene.
- **Alternativas descartadas:** sólo RLS (un bug en una policy compromete todo), sólo filtro app (un bug en un service expone datos cruzados).

### ADR-009 — 2026-05-04 — UUID v4 ahora, v7 para tablas hot-path en MVP FO

- **Decisión:** En esta migración inicial usamos `gen_random_uuid()` (v4) para `tenants`, `users`, `properties`, `audit_log`. Cuando entren las tablas de hot-path en MVP FO (`reservations`, `folio_entries`, `room_status_log`) introduciremos UUID v7 generado en app con `uuid` v10 para mejor localidad de índices.
- **Razón:** v4 es estándar y suficiente para tablas de configuración. v7 da ganancia real solo en tablas con write rate alto.
- **Alternativas descartadas:** v7 desde el inicio (sin beneficio en tablas de cardinalidad baja), bigserial (no funciona multi-tenant ni distribuido).

### ADR-010 — 2026-05-04 — Soft delete en entidades de dominio

- **Decisión:** Toda entidad de dominio lleva `deleted_at TIMESTAMPTZ NULL`. Las consultas filtran por `deleted_at IS NULL` por defecto. Hard delete sólo en datos transitorios (sesiones, jobs completados, locks).
- **Razón:** Compliance hotelera y auditoría legal exigen poder reconstruir histórico. Cancelaciones, modificaciones de tarifa, cambios de huésped — todo debe ser revisable.
- **Alternativas descartadas:** hard delete + audit log (audit guarda snapshot pero la integridad referencial se rompe), tablas históricas separadas (duplicación, complejidad).

### ADR-011 — 2026-05-04 — Audit log via triggers Postgres (append-only inmutable)

- **Decisión:** Tabla `audit_log` poblada por triggers `AFTER INSERT/UPDATE/DELETE` en cada tabla operativa. Función trigger `SECURITY DEFINER` (corre como owner). RLS sobre `audit_log` permite SELECT por tenant pero bloquea INSERT/UPDATE/DELETE directos desde el rol de aplicación.
- **Razón:** Capturar cambios desde el origen (DB) garantiza que ningún code path se los salte (incluye psql, admin tools, jobs externos). Crítico para Night Audit y compliance GDPR. Inmutable a nivel role permissions.
- **Alternativas descartadas:** auditoría a nivel aplicación (frágil — un service que olvida llamar al logger pierde el evento), event sourcing puro (sobrecomplica MVP).

### ADR-012 — 2026-05-04 — Roles Postgres separados: owner (`pms`) vs app (`pms_app`)

- **Decisión:** El rol `pms` (superuser, BYPASSRLS) ejecuta migraciones y owns las tablas. El rol `pms_app` (login estándar, sin BYPASSRLS) es el que usa la API en runtime — RLS aplica sobre él. `DATABASE_URL` apunta a `pms_app`; `DIRECT_URL` (Prisma) apunta a `pms` para migraciones.
- **Razón:** Sin esta separación, RLS no se puede testear (superuser bypassea siempre). Además, limitar privilegios del rol runtime es defensa en profundidad — un compromise del API no permite alterar `audit_log` ni saltarse RLS.
- **Alternativas descartadas:** un único rol (RLS no aplica si es superuser), múltiples roles por feature (overkill en MVP).

### ADR-013 — 2026-05-05 — Validación JWT con `jose` (sin Passport)

- **Decisión:** La API valida JWTs de Keycloak usando `jose` con `createRemoteJWKSet` (cachea las claves públicas y rota automáticamente). Sin `@nestjs/passport` ni `passport-jwt`. JwtAuthGuard global + `@Public()` para opt-out (healthz, readyz). RolesGuard global + `@Roles()` para autorización fina.
- **Razón:** `jose` es 0-deps, mantenido activamente, y es el estándar moderno (lo usa NextAuth, Cloudflare Workers, etc.). Passport añade abstracción innecesaria para nuestro caso (un solo provider, JWT siempre). El patrón global guard + `@Public()` es default-secure (todo protegido salvo opt-out explícito).
- **Alternativas descartadas:** `@nestjs/passport` (overhead innecesario), `keycloak-connect` (legacy, no soporta Fastify limpio).

### ADR-014 — 2026-05-05 — `tenant_id` como claim del JWT (User Attribute mapper en Keycloak)

- **Decisión:** Cada usuario en Keycloak lleva un atributo `tenant_id` (UUID). Un Protocol Mapper de tipo "User Attribute" en el client `pms-api` lo expone como claim `tenant_id` en el access token. La API extrae `tenant_id` del JWT validado y lo pasa a `prisma.withTenant()`. Ningún endpoint acepta `tenant_id` en query/body — siempre viene del token firmado.
- **Razón:** El usuario no puede manipular su `tenant_id` (la firma JWT lo protege). Es la única fuente de verdad. RLS + JWT firmado = aislamiento robusto.
- **Alternativas descartadas:** subdominio por tenant (operacionalmente caro), header `X-Tenant-Id` (manipulable, requiere lookup adicional), realm por tenant (ingestionable a escala).

### ADR-015 — 2026-05-05 — Sin AsyncLocalStorage en MVP — pasamos contexto explícitamente

- **Decisión:** Los handlers reciben `@CurrentUser()` y pasan `tenantId`, `actorId`, `correlationId` explícitamente a `prisma.withTenant()`. No usamos AsyncLocalStorage para auto-propagación.
- **Razón:** Más simple, más explícito, más fácil de testear. ALS añade complejidad y debugging difícil; lo introducimos sólo si el explícito empieza a doler (probable en Sprint 2 cuando haya muchos services).
- **Alternativas descartadas:** ALS desde día 1 (overkill), `nestjs-cls` (otra dep para algo que no necesitamos aún).

### ADR-018 — 2026-05-05 — Modelo de datos pre-work antes de hablar con hoteles

- **Decisión:** Avanzar el schema de Sprint 2 (RoomType, Room, Guest, RatePlan, Reservation, ReservationGuest, Folio, FolioEntry) **antes** de las conversaciones con hoteles, asumiendo el shape universal de la industria PMS. **Workflows / features quedan pausados** hasta tener feedback.
- **Razón:** Los _entities_ y _attributes core_ son convergentes en cualquier PMS hotelero (Mews, Cloudbeds, Apaleo, Opera) — guests con DNI/NIE/passport, reservas con arrival/departure/status, folios append-only, room status enum, etc. Pre-trabajar el schema **desbloquea Sprint 2 funcional el día que llegue feedback**, sin re-trabajar arquitectura. Lo que cambia con feedback son enums (statuses específicos) y campos `attributes` (jsonb) — extensibles sin migración.
- **Mecanismo de extensibilidad:**
  - Cada entidad operativa lleva un campo `attributes JSONB` para hotel-specific extras (loyalty number, bed config, restricciones de tarifa) sin ALTER TABLE.
  - Enums conservadores (5-9 valores comunes); valores adicionales se añaden con `ALTER TYPE … ADD VALUE`.
  - `notes TEXT` libre en entidades grandes (Guest, Reservation) para cosas que no caben en estructura.
- **Lo que NO se pre-trabaja:** controllers, services, DTOs de API, eventos del dominio (`reservation.created`, etc.), tools MCP de FO. Eso espera al feedback porque el _contrato_ depende del _workflow_.
- **Riesgo asumido:** si el feedback obliga a re-modelar una entidad core (poco probable), tendremos una migración de cleanup adicional. Probabilidad estimada: <15% según benchmarks con Mews/Apaleo data models.
- **Alternativas descartadas:** esperar 100% al feedback (perder semanas), ir hasta features (re-trabajar mucho si feedback obliga a ajustar dominio).

### ADR-017 — 2026-05-05 — Observabilidad: OpenTelemetry SDK + Prometheus + correlación con Pino

- **Decisión:**
  - `@opentelemetry/sdk-node` arrancado como **primer import** de `main.ts` para que las auto-instrumentations (HTTP, Fastify, Prisma, NATS, Pino) parchen los módulos antes de que NestJS los cargue.
  - **Trazas:** OTLP HTTP exporter si `OTEL_EXPORTER_OTLP_ENDPOINT` está set (apunta a un Jaeger / Grafana Tempo / OTel Collector); si no, instrumentación activa pero sin export — los `trace_id`/`span_id` siguen propagándose y aparecen en los logs (correlación gratis).
  - **Métricas:** Prometheus exporter en `:9464/metrics` siempre activo. Scrape estándar.
  - **Logs:** la auto-instrumentation de Pino inyecta `trace_id`/`span_id` automáticamente cuando hay span activo — sin tocar `logger.module.ts`.
  - **Disable:** `OTEL_ENABLED=false` (útil en CI/tests donde no queremos bind del puerto 9464).
- **Razón:** OTel es el estándar de facto para observabilidad multi-vendor. Auto-instrumentations cubren todo lo que usamos sin código manual. Pino + Prometheus son los formatos que cualquier ecosistema (Grafana, Datadog, Honeycomb) acepta sin adaptación. Nada de vendor lock-in.
- **Alternativas descartadas:** Datadog APM (lock-in + caro), instrumentación manual (mantenimiento), `pino-opentelemetry-transport` (la auto-instrumentation ya hace lo mismo y sin overhead extra).
- **Pendiente (Sprint 2+):** añadir Jaeger/Tempo a `docker-compose.yml` cuando empecemos a depurar latencia; alertas Prometheus; sampling configurable; spans manuales en operaciones de dominio críticas (Night Audit, asignación HSK).

### ADR-019 — 2026-05-05 — Nombre de producto: **Aubergine**

- **Decisión:** El producto público se llama **Aubergine**. El repo (`kermit-o/pms`), los packages (`@pms/api`, `@pms/db`, `@pms/eventbus`, `@pms/mcp-tools`) y el codename interno conservan `pms` para no propagar un rename invasivo en este momento. La marca aparece en UI, README público, copy comercial, dominio, emails transaccionales y documentación de cara a hoteles.
- **Razón:** Nombre corto, memorable, no descriptivo (no constriñe el roadmap a "PMS"), pronunciable en ES y EN, sin colisiones con incumbentes (Mews, Cloudbeds, Apaleo, Opera). El descriptor "PMS for boutique hotels" acompaña en la wordmark.
- **Implicaciones inmediatas:** título y subtítulo de UI FO ("Aubergine"), `<title>` de la app web, `package.json` `description`, README público. **No** se renombra el repo ni los packages internos.
- **Alternativas descartadas:** rename total a `@aubergine/*` ahora (re-trabajo de imports + lockfile + Docker COPY paths sin valor de producto inmediato; se hará en una pasada de marca cuando haya cliente firmado).

### ADR-020 — 2026-05-05 — Sprint 2 = MVP FO **completo** (sin recortes), UI desde día 1

- **Decisión:** Sprint 2 entrega el alcance íntegro de §4.1 — Reservas (CRUD + walk-in + group bookings), check-in / check-out, asignación y cambio de habitación, folio (cargos manuales + pagos parciales + splits), tarjeta de registro + **SES.HOSPEDAJES sender**, cardex GDPR, locking de operaciones críticas — **más** UI FO Next.js 15 desde el primer día y **más** copiloto conversacional FO básico (subset MCP de FO consumible por Claude). No hay "minimum viable" del subset; las piezas que se posponen están explícitamente en §4.4 (Channel Manager, Revenue, POS, Booking engine, Loyalty), no dentro de §4.1.
- **Razón:** Un hotel boutique no firma con un PMS que no ve y no opera punta-a-punta. La validación de mercado exige una UI usable y los flujos FO completos. Cortar el alcance dentro de §4.1 reabre el _ticking debt_ de "lo terminamos en V2" que mata adoption en SaaS B2B operacional.
- **Lo que esto implica:**
  - **UI desde día 1** (`apps/web-fo` Next.js 15 + Tailwind + shadcn/ui), con login Keycloak (OIDC), dashboard, calendar Mews-style, formulario de reserva, cardex, folio, ajustes. Mobile-friendly aunque la primary surface es desktop.
  - **Catálogo de eventos FO** (≥8 tipos: `reservation.created/updated/cancelled`, `reservation.checked_in/out`, `folio.charge_added`, `folio.payment_received`, `room.assigned`, `cardex.synced`).
  - **Catálogo MCP FO** (≥6 tools: `create_reservation`, `check_in`, `check_out`, `add_folio_charge`, `assign_room`, `query_availability`).
  - **Compliance ES**: SES.HOSPEDAJES XML sender (idempotente, retriable, con DLQ), cardex GDPR.
  - **Locking**: estado `closed` en folios, día de operación cerrado bloquea mutaciones, idempotencia en pagos.
  - **Copiloto FO**: agente Claude con acceso a las tools MCP de FO en una superficie conversacional de la UI (sidebar). En MVP traduce intención en confirmaciones de tools (no auto-ejecuta acciones financieras sin confirmación humana).
- **Lo que NO se mete en Sprint 2:** NA, HSK, multi-property, Channel Manager, integraciones POS/contabilidad, booking engine — todo esto sigue en §4.4 / §10.
- **Riesgo asumido:** ventana de Sprint 2 más larga (estimación 6-7 semanas en lugar de 4) pero el resultado es _piloteable_ por un hotel real, no un demo.
- **Alternativas descartadas:** "MVP del MVP" (ya rechazado por el sponsor — el SaaS no se vende sin UI ni sin compliance ES), entregar UI en Sprint 3 (riesgo de _backend que nadie valida_), posponer SES.HOSPEDAJES a piloto (es ilegal operar en España sin él).

### ADR-021 — 2026-05-06 — Sprint 3 = MVP Night Audit **completo** (sin recortes), batch idempotente + reportes generativos

- **Decisión:** Sprint 3 entrega §4.2 íntegro: cierre diario que postea room charges + taxes + packages, roll-over de fecha de negocio (avanza `business_date` global del property), no-shows automáticos, los 5 reportes esenciales (Manager Report, In-house, Arrivals/Departures, Revenue, Tax), reconciliación de cajas (cash drawer count vs payments) y locking inmutable del día cerrado (ya existe `business_day_states` desde Sprint 2; NA lo activa). Con UI desde el día 1 (página `/night-audit` + `/reports`) y consume `business_day.closed` que ya emite Sprint 2.
- **Arquitectura del cierre:**
  - Operación idempotente sobre `(propertyId, businessDate)`. Re-ejecutar el cierre del mismo día retorna el mismo resumen sin duplicar cargos.
  - Implementado como una **secuencia de pasos** (post charges → tax → packages → no-shows → snapshot → close). Cada paso emite un evento `night_audit.step_completed`. Si un paso falla, el cierre queda en `IN_PROGRESS` con el `lastFailedStep` y se puede reanudar (no rollback completo: las entries del folio son append-only).
  - Cada paso tiene su propio `idempotencyKey` interno derivado de `(businessDate, step, scope)`, así que un retry no inserta dos veces.
- **Snapshot de reportes:** los 5 reportes core se generan al cerrar el día y se persisten en `night_audit_snapshots` (JSONB) — son inmutables. Reportes ad-hoc en cualquier fecha siguen siendo computados on-demand desde las entries de folio (lectura).
- **No-shows:** el cierre marca `NO_SHOW` toda reservation con `arrivalDate <= businessDate` que siga en `PENDING`/`CONFIRMED`. Aplica penalty fee según política del rate plan (campo `attributes.noShowPolicy`); si no hay política, se loguea sin cargo.
- **Reportes generativos (IA):** además de los 5 estructurados, el copiloto FO existente expone una nueva tool `generate_report` (read-only, auto-exec) que toma una fecha y devuelve un resumen narrativo del día. **No** es decisión-making — es transparencia operacional.
- **Lo que NO se mete en Sprint 3:** HSK PWA (Sprint 4), forecasting/anomaly detection (post-MVP), auto-reconciliación bancaria (necesita integración bancaria real), reportes BI complejos (RevPAR/ADR trends multi-mes).
- **Riesgo asumido:** ventana de Sprint 3 estimada 5-6 semanas. El paso más complejo es la reconciliación de cajas — depende de cómo el hotel piloto cuente efectivo (papel vs digital). Validar con UAT antes de cerrar la UI.
- **Alternativas descartadas:** transaction-style rollback (incompatible con append-only de Sprint 2; los cargos posteados son legalmente inmutables), cierre manual sin batch (rompe idempotencia y compliance), reportes solo on-demand (un día auditado tiene que ser un snapshot inmutable o el director no puede confiar en los números).

### ADR-016 — 2026-05-05 — Eventbus: NATS JetStream + envelope estándar + catálogo Zod versionado

- **Decisión:**
  - Un único stream `pms-events` con subject pattern `pms.events.>` (1 stream catch-all en MVP; particionar por dominio si la carga lo requiere).
  - Retention=Limits con `max_age` 30 días, storage=File.
  - Envelope estándar: `{ id, type, schemaVersion, tenantId, actorId, correlationId, occurredAt, payload }`.
  - `id` (UUID v4) se publica también como header `Nats-Msg-Id` para deduplicación (duplicate window por defecto 2min).
  - Catálogo central tipado con Zod (`packages/eventbus/src/catalog/`), una entrada por tipo de evento con `schemaVersion`. Breaking change → entrada nueva (p.ej. `property.created` v2), no se rompe v1.
  - El payload se valida con Zod **antes** de publicar (fail-fast).
- **Razón:** NATS JetStream es ligero (1 binario, 4222/8222 ports), muy rápido, soporta exactly-once vía dedup, y tiene API moderna en Node. Suficiente para 1-1000 hoteles. Kafka introduciría complejidad operativa (Zookeeper/KRaft, particionado) sin beneficio a esta escala.
- **Alternativas descartadas:** Kafka (overkill), Redis Streams (sin replicación robusta), RabbitMQ (no es tan stream-first).
- **Pendiente próximos sprints:** consumer groups durables por tipo, dead-letter handling, métricas Prometheus de lag, schema registry separado del código si crecen los consumers externos.

---

## 14. Glosario

- **PMS** — Property Management System.
- **FO** — Front Office (recepción).
- **NA** — Night Audit (auditoría nocturna).
- **HSK** — Housekeeping (gobernanta / limpieza).
- **OTA** — Online Travel Agency (Booking, Expedia, etc.).
- **ADR** (en hotel) — Average Daily Rate. (en arquitectura) — Architecture Decision Record.
- **RevPAR** — Revenue Per Available Room.
- **MCP** — Model Context Protocol (Anthropic).
- **RLS** — Row-Level Security (Postgres).
- **SES.HOSPEDAJES** — registro obligatorio de huéspedes en España.

---

## 15. Referencias y benchmarks

- **Opera Cloud (Oracle)** — líder enterprise, débil en UX y API.
- **Mews** — referencia en cloud-native, fuerte en UX.
- **Apaleo** — referencia en API-first.
- **Cloudbeds** — fuerte en independientes.
- **RoomRaccoon** — fuerte en boutique pequeño.
- **Optii / Hotelkit** — referencias en HSK con IA.
