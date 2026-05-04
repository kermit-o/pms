# PMS SaaS — Documento Maestro del Proyecto

> **Este documento es la fuente única de verdad del proyecto.**
> Antes de iniciar cualquier sesión de trabajo, leerlo.
> Antes de cambiar el rumbo, actualizarlo aquí primero.
> Si una conversación contradice este archivo, gana este archivo (salvo que se actualice explícitamente).

---

## 0. Estado actual

- **Fase:** Planificación / Pre-MVP. No hay código todavía.
- **Branch de desarrollo:** `claude/plan-hotel-saas-rWaWw`
- **Última actualización:** 2026-05-04

---

## 1. Visión

Construir un **PMS (Property Management System) SaaS AI-native** para hoteles, que compita con Opera Cloud, Mews, Cloudbeds y Apaleo en los flancos donde son débiles: **UX, precio, API-first y agentes de IA integrados**.

**Tagline interno:** *"AI-native PMS"* — no es un PMS con IA pegada encima, sino un PMS diseñado alrededor de la IA desde el día uno.

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

## 3. Mercado objetivo (a confirmar con usuario)

| Decisión | Pendiente | Notas |
|---|---|---|
| Tamaño hotel | ⏳ | Recomendado: boutique 30-150 habitaciones |
| Geografía inicial | ⏳ | Recomendado: España (GDPR + SES.HOSPEDAJES + factura electrónica) |
| Single vs multi-property | ⏳ | Recomendado: single-property en MVP, multi-property en V2 |
| Idiomas MVP | ⏳ | Recomendado: ES + EN |
| Multi-divisa | ⏳ | Recomendado: sí desde el inicio (low effort) |
| API-first / terceros | ⏳ | Recomendado: SÍ — diferenciador clave |

> ⚠️ Estas decisiones se cierran antes de empezar a codear.

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

## 6. Stack técnico

| Capa | Elección | Alternativa |
|---|---|---|
| Backend | **Node.js + TypeScript + NestJS** | Python + FastAPI |
| DB | **PostgreSQL** con RLS | — |
| Cache / colas | **Redis + BullMQ** | — |
| Frontend FO/NA | **Next.js + React** (desktop) | — |
| Frontend HSK | **Next.js PWA mobile-first** | — |
| Auth | **Keycloak self-hosted** o Clerk | Auth0 |
| Eventos | **NATS** o Kafka (event-driven desde día 1) | — |
| IA / LLM | **Claude (Anthropic)** como modelo principal | Llama/Mistral local opcional |
| Protocolo de tools | **MCP (Model Context Protocol)** | — |
| Observabilidad | OpenTelemetry + Grafana | — |
| Infra | Docker + Kubernetes (o Fly.io en early stage) | — |

> Decisión final del stack: confirmar antes de iniciar el primer commit de código.

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

| Fase | Duración | Objetivo |
|---|---|---|
| **0. Discovery** | 2-3 sem | Cerrar decisiones pendientes (sección 3), validar con 2-3 hoteles. |
| **1. Foundation** | 1 mes | Auth, multi-tenancy, modelo de datos base, CI/CD, infra. |
| **2. MVP FO** | 2 meses | Reservas + check-in/out + folio + cardex. |
| **3. MVP NA** | 1 mes | Cierre diario + reportes esenciales. |
| **4. MVP HSK** | 1 mes | PWA mobile + estados + asignación. |
| **5. Piloto** | 1-2 meses | 1-2 hoteles reales en producción. |
| **6. IA V1** | 2 meses | Copiloto operativo básico, anomaly detection NA, asignación inteligente HSK. |
| **7. GTM** | continuo | Sales, partnerships, expansión geográfica. |

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

## 12. Decisiones pendientes (bloqueantes para iniciar código)

- [ ] Tamaño y tipo de hotel objetivo (ver §3).
- [ ] Geografía inicial (ver §3).
- [ ] Single vs multi-property en MVP (ver §3).
- [ ] Idiomas y multi-divisa (ver §3).
- [ ] Confirmar stack final (ver §6).
- [ ] Presupuesto / equipo / timeline real.
- [ ] Validación con 2-3 hoteles reales antes de codear.

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
- **Decisión:** NATS/Kafka desde el primer commit. Cada cambio de estado emite evento.
- **Razón:** La IA necesita streams, no requests. Auditoría continua imposible sin eventos.
- **Alternativas descartadas:** event sourcing en V2 (cambiar después es muy caro).

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
