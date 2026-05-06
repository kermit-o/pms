# Sprint 4 — MVP Housekeeping (Aubergine)

> **Versión:** 1.0 — 2026-05-06
> **Branch de desarrollo:** `claude/sprint-4-housekeeping`
> **Documento padre:** [`PROJECT.md`](../PROJECT.md) §4.3 + ADR-022.
> **Predecesores:** Sprint 2 (FO) + Sprint 3 (NA) mergeados a `main`. `room.status` y eventos `room.status_changed` ya existen desde S2-W5.

---

## 0. Norte estratégico

Sprint 4 cierra el **tercer y último módulo crítico del MVP** (Housekeeping) según `PROJECT.md` §4.3. Sale del sprint un sistema con:

- Camareras que abren la PWA en su móvil, ven sus habitaciones asignadas, marcan estados, reportan discrepancias y registran objetos perdidos sin tocar un PC.
- Supervisor que asigna tareas en bulk al inicio del turno desde su escritorio.
- Cola offline-tolerant: si la planta -1 no tiene cobertura, la camarera marca y al volver se sincroniza.
- Métricas de tiempo por habitación que alimentan el modelo de asignación óptima (Sprint 5+).

**Definition of Done de Sprint 4:**

1. Supervisor crea tareas HSK para una fecha (manual o auto-bootstrap a partir de `business_day` cerrado de NA).
2. Camarera abre `/hsk` en el móvil, ve su lista, abre una habitación y marca `Clean → Inspected` con un click.
3. Discrepancy detectada (room marcada Clean pero el reporte In-house dice CHECKED_IN sin sleep) → tipo `SLEEP / SKIP / SLEEPER` registrado.
4. Lost & Found: foto + descripción → fila con estado `HELD`, claim posterior con `CLAIMED + claimedBy`.
5. Voice-first stretch: en `/hsk` un botón "voz" que dicta la nota o el estado (Sprint 5 lo conecta al modelo).
6. CI verde, e2e cubre el happy path "supervisor asigna → camarera marca Clean → supervisor ve actualizada".
7. RUNBOOK §13 nuevo con guion para supervisor + camarera.

**Lo que explícitamente NO se entrega:**

- Visión por computadora para inspección post-limpieza (post-MVP IA V1).
- Mantenimiento predictivo (post-MVP).
- Voice-first end-to-end (Sprint 5+).
- Asignación óptima IA (datos recolectados aquí; modelo en Sprint 5+).
- Integraciones con Optii / Hotelkit (post-MVP).

---

## 1. Arquitectura del sprint

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web-hsk  (Next.js 15 PWA · mobile-first)                       │
│   - /                      (pantalla camarera: mis tareas hoy)       │
│   - /room/[number]         (acción: marcar status, foto, notas)      │
│   - /supervisor            (panel desktop: asignación bulk + KPIs)   │
│   - /lost-found            (registrar / buscar / claim)              │
│   - manifest.json + sw.js  (instalable, offline-first)               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ REST + cola offline (IndexedDB)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  apps/api                                                            │
│   - housekeeping/           (tasks, discrepancies, lost-found)       │
│      ├─ tasks.service.ts                                             │
│      ├─ discrepancies.service.ts                                     │
│      ├─ lost-found.service.ts                                        │
│      └─ assignments.service.ts  (bulk + auto-bootstrap)              │
│   - copilot/ → 4 tools nuevos (catalog/hsk en mcp-tools)             │
└─────────┬───────────────────────────────────────┬────────────────────┘
          │ Prisma (RLS via withTenant)           │ NATS pub
          ▼                                       ▼
   PostgreSQL 16                          NATS JetStream
   - housekeeping_tasks                   pms.events.hsk.*
   - housekeeping_discrepancies
   - lost_found_items
```

**Principios arquitecturales (heredados, sin excepción):**

- API-first → endpoints REST documentados antes que la PWA los consuma.
- Event-driven → cada cambio de estado HSK emite un evento.
- MCP-first → cada acción operacional es una tool.
- Multi-tenant by default → todo via `withTenant`.
- Audit log inmutable → triggers Postgres en cada tabla nueva.
- **Mobile-first**: si no funciona en un Android de gama media a 3G, no se mergea.
- **Offline-tolerant**: las acciones de camarera (marcar status, registrar lost & found) deben encolarse y sincronizar.

---

## 2. Dominios y entregables backend

### 2.1 `housekeeping/tasks` — tareas + asignación

**Endpoints:**

- `POST /housekeeping/tasks` — crear tarea individual.
- `POST /housekeeping/tasks/bulk` — crear N tareas para una fecha (input: `propertyId`, `businessDate`, `roomIds[]`, `assignedToUserId?`).
- `POST /housekeeping/tasks/auto` — auto-bootstrap del día: crea una tarea por cada room en estado `DIRTY` o con departure ese día (idempotente sobre `(property, businessDate, roomId)`).
- `GET /housekeeping/tasks` — lista con filtros (`assignedToUserId`, `status`, `from`, `to`, `roomNumber`).
- `GET /housekeeping/tasks/:id` — detalle.
- `POST /housekeeping/tasks/:id/start` — camarera entra → estado `IN_PROGRESS`, set `startedAt`.
- `POST /housekeeping/tasks/:id/complete` — camarera termina → estado `COMPLETED`, set `completedAt`, calcula `durationMin`. Opcionalmente transiciona la habitación a `CLEAN` o `INSPECTED`.
- `POST /housekeeping/tasks/:id/cancel` — supervisor anula.

**Reglas:**

- Estados (enum): `PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`.
- Una habitación puede tener varias tareas en el día (limpieza + inspección). `taskType` enum: `CHECKOUT_CLEAN`, `STAYOVER_CLEAN`, `INSPECTION`, `MAINTENANCE`.
- `auto` es idempotente: re-llamar genera 0 nuevas filas si ya existen para `(property, date, room, type)`.
- Locking: si el `business_day` está cerrado, mutaciones rechazadas (excepto admin override).

**Eventos (subjects `pms.events.hsk.*`):**

- `housekeeping.task_assigned` v1
- `housekeeping.task_started` v1
- `housekeeping.task_completed` v1
- `housekeeping.task_cancelled` v1

### 2.2 `housekeeping/discrepancies` — sleep / skip / sleeper

**Endpoints:**

- `POST /housekeeping/discrepancies` — registrar (input: `taskId`, `type`, `notes`).
- `GET /housekeeping/discrepancies` — lista por property + fecha.
- `GET /housekeeping/discrepancies/:id`.

**Reglas:**

- `type` enum:
  - `SLEEP` — habitación reservada y en CHECKED_IN, pero la cama no parece haber sido usada.
  - `SKIP` — reserva pasó por CHECKED_IN/CHECKED_OUT pero la habitación nunca apareció DIRTY (salto en el ciclo).
  - `SLEEPER` — habitación VACANT pero la cama parece usada (huésped no registrado).
- Auto-detección al `task_completed`: si la `room.status` final no encaja con la reserva activa según el matrix de S2, se sugiere una discrepancia (no se inserta automáticamente — la camarera la confirma con un tap).

**Eventos:**

- `housekeeping.discrepancy_reported` v1

### 2.3 `housekeeping/lost-found` — objetos perdidos

**Endpoints:**

- `POST /housekeeping/lost-found` — registrar nuevo (input: `roomId?`, `description`, `photoUrl?`).
- `GET /housekeeping/lost-found` — lista con filtros (`status`, `roomId`, `from`, `to`).
- `GET /housekeeping/lost-found/:id`.
- `POST /housekeeping/lost-found/:id/claim` — entregar al huésped (input: `claimedBy`, `claimedAt?`).
- `POST /housekeeping/lost-found/:id/dispose` — descartar tras retención (típico 90 días).

**Reglas:**

- Estados: `HELD`, `CLAIMED`, `DISPOSED`.
- `photoUrl` opcional en MVP (almacenamiento de fotos = follow-up; por ahora se acepta una URL externa o data: URL pequeña como base64).

**Eventos:**

- `lost_found.item_held` v1
- `lost_found.item_claimed` v1
- `lost_found.item_disposed` v1

### 2.4 Extensión copilot — 4 tools HSK nuevas

En `packages/mcp-tools/src/catalog/hsk.ts`:

| Tool                       | Mutating | Financial | Descripción                                                    |
| -------------------------- | -------- | --------- | -------------------------------------------------------------- |
| `query_room_status`        | false    | false     | Devuelve el status de una habitación o el resumen del property |
| `assign_housekeeping_task` | true     | false     | Crea una tarea HSK para una habitación con asignación opcional |
| `mark_room_status`         | true     | false     | Cambia el status de una habitación (alias del tool de FO/HSK)  |
| `report_discrepancy`       | true     | false     | Registra una discrepancy a partir de un task                   |

`FoToolRouter` se renombra a `ToolRouter` internamente y agrega los 4 nuevos casos. Stub adapter del copilot reconoce intents "asignar limpieza", "estado de la habitación".

---

## 3. Datos y migraciones nuevas

| Migración                             | Tablas / enums                                                                     | Notas                |
| ------------------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| `20260513_housekeeping_tasks`         | `housekeeping_tasks` + enums `housekeeping_task_status` / `housekeeping_task_type` | RLS + audit + GRANTs |
| `20260514_housekeeping_discrepancies` | `housekeeping_discrepancies` + enum `housekeeping_discrepancy_type`                | RLS + audit          |
| `20260515_lost_found_items`           | `lost_found_items` + enum `lost_found_status`                                      | RLS + audit          |

Indexado obligatorio: `(tenant_id, property_id, status, scheduled_for)` en tasks; `(tenant_id, property_id, business_date)` en discrepancies; `(tenant_id, property_id, status)` en lost & found.

---

## 4. Frontend — `apps/web-hsk` (PWA)

### 4.1 Stack y scaffolding

- Next.js 15 (App Router) + React 19 (mismo set que web-fo).
- Tailwind v4 (paleta `aubergine` reusada) + variantes `mobile-first` (`sm:` solo donde aporta).
- `next-pwa` o configuración de `service-worker` manual + `manifest.json` para instalación.
- TanStack Query con `persistQueryClient` (IndexedDB) para cache offline.
- `next-auth` v5 + Keycloak provider con un client distinto (`pms-hsk`); login PIN + scan QR room number stretch.
- E2E con Playwright en device emulation (`devices['Pixel 7']`).

### 4.2 Páginas / rutas

- `/login` — PIN o redirect a Keycloak.
- `/` — pantalla camarera: lista de tareas asignadas hoy ordenadas por planta, agrupadas por estado. Big tap targets, status pills.
- `/room/[number]` — detalle de la tarea: timer (start/stop), botones de status, botón foto, botón discrepancy.
- `/supervisor` — panel desktop-friendly: matriz rooms × status del día, drag-to-assign, KPIs (tareas completadas, tiempo medio, discrepancias).
- `/lost-found` — registro y búsqueda; cámara → photoUrl base64 (compresion clienta hasta 200 KB).

### 4.3 Branding

- Mismo wordmark Aubergine, color primario `#5C2A4D`.
- Modo "alto contraste" implícito (camareras en pasillos con luz variable).
- Splash + icon set 192/512/maskable para PWA.

---

## 5. Calidad y verificación

- **Unit:** Vitest sobre cada service + reglas de transición. Cobertura objetivo ≥75% en `housekeeping/`.
- **Integration:** spec a nivel servicio que crea task → start → complete → verifica `task_completed` event + `room.status` actualizado.
- **E2E (Playwright):**
  1. Login supervisor → asigna 5 tareas → camarera (otra sesión) ve la lista.
  2. Camarera marca una tarea `Clean` → supervisor ve la actualización.
  3. Lost & Found: crear con foto base64 → buscar → claim.
  4. PWA: emulación móvil con `pwa: true` y verificar `manifest.json` cargado.
- **CI:** mismo workflow (format / lint / typecheck / test / build) extendido para `@pms/web-hsk`.

---

## 6. Plan por semanas (estimación 4-5 semanas)

| Semana | Foco backend                                                   | Foco frontend                                                                  | Foco IA                                         |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| **1**  | Migraciones + tasks service (CRUD + eventos) + UI mobile lista | Scaffold web-hsk PWA (Next.js + Tailwind + manifest + sw) + login PIN/Keycloak | —                                               |
| **2**  | Bulk + auto-bootstrap + discrepancies service                  | `/` (mis tareas) + `/room/[number]` (start/complete)                           | —                                               |
| **3**  | Lost & Found service + endpoints                               | `/lost-found` (foto base64 + claim) + `/supervisor` (assign panel)             | —                                               |
| **4**  | MCP tools HSK + integración con copilot                        | E2E mobile + offline cache + bug bash                                          | `query_room_status`, `assign_housekeeping_task` |
| **5**  | UAT + RUNBOOK §13 + métricas Prometheus de duración            | Polish accesibilidad + PWA install prompt                                      | —                                               |

---

## 7. Riesgos y mitigaciones

| Riesgo                                                                | Probabilidad | Impacto | Mitigación                                                                                           |
| --------------------------------------------------------------------- | ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| Cobertura móvil inestable en sótano/áreas remotas                     | Alta         | Medio   | Cola offline IndexedDB + retry exponencial; UAT en el hotel piloto con un Pixel/Galaxy de gama media |
| PWA instalación bloqueada por iOS Safari                              | Media        | Bajo    | iOS soporta PWA limitada; documentar "añadir a pantalla inicio"; si crítico, app nativa lite en V2   |
| Foto base64 hace que el payload supere los límites de NATS / Postgres | Media        | Medio   | Comprimir a 200 KB en cliente; subir a S3-compatible cuando se enchufe almacenamiento (V2)           |
| Camarera no acepta el PIN o la URL larga                              | Alta         | Alto    | Login QR (escanea código pegado en el carrito de housekeeping) en stretch S4 W4-5                    |
| Conflicto de versiones del service worker tras update                 | Media        | Medio   | Versionar SW + `skipWaiting` + recarga forzada; testar con `chromium devtools`                       |

---

## 8. Salida de Sprint 4 (handoff a Sprint 5)

- Hotel piloto opera HSK end-to-end desde el móvil de las camareras.
- Métricas de duración por habitación capturadas → el modelo de asignación óptima de Sprint 5 puede entrenar/heurística sobre datos reales.
- Catálogo de eventos HSK estable y versionado.
- Catálogo MCP HSK documentado.
- **MVP completo (FO + NA + HSK)** — el sistema es operable end-to-end por un hotel boutique español.

---

## 9. Referencias

- [`PROJECT.md`](../PROJECT.md) — documento maestro.
- [`PROJECT.md` ADR-022](../PROJECT.md#adr-022--2026-05-06--sprint-4--mvp-housekeeping-completo-sin-recortes-pwa-mobile-first-separada)
- [`docs/SPRINT-3-PLAN.md`](./SPRINT-3-PLAN.md) — Sprint 3 (predecesor inmediato).
- [`RUNBOOK.md`](../RUNBOOK.md) — operaciones (§12 Night Audit; §13 HSK aterriza en W5).
