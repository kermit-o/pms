# Sprint 5 — Piloto en producción + polish del MVP (Aubergine)

> **Versión:** 1.0 — 2026-05-06
> **Branch de desarrollo:** `claude/sprint-5-piloto`
> **Documento padre:** [`PROJECT.md`](../PROJECT.md) §10 fase 5 + ADR-022 cerrado.
> **Predecesores:** Sprint 4 (HSK) mergeado a `main` (PR #8). MVP completo: FO + NA + HSK + Copilot FO.

---

## 0. Norte estratégico

Sprint 4 cerró el último módulo crítico del MVP. El sistema es operable end-to-end por un hotel boutique español. Sprint 5 **no añade features grandes** — saca a Aubergine de "demo en staging" a "**1 hotel piloto facturando con esto**".

**Definition of Done de Sprint 5:**

1. Un hotel piloto (8-30 habitaciones) opera con Aubergine en producción durante al menos 2 semanas seguidas:
   - Front desk usa la UI todos los turnos.
   - Night audit cierra los 14 días sin escalar a soporte humano más de 1 vez.
   - Camareras usan la PWA para todas las habitaciones del día.
2. Datos del hotel migrados desde su sistema actual (Excel / Mews export / CSV) en una pasada limpia.
3. Compliance ES end-to-end real: SES.HOSPEDAJES enviando partes de huéspedes a producción de Guardia Civil con confirmación.
4. Observabilidad lista para SRE: dashboards Grafana con SLOs definidos (p95 API < 400 ms, error rate < 1%, NA close success > 99%) + alertas en Slack/PagerDuty.
5. RUNBOOK §14 (incident response) + §15 (onboarding nuevo hotel) escritos y probados.
6. Backups + restore probados con un drill real (DR test).
7. Stretch IA V1: heurística inicial de asignación óptima de HSK que el supervisor ve como sugerencia (no auto-ejecuta — ADR-020).

**Lo que explícitamente NO se entrega:**

- Channel Manager / Revenue Management / POS / Booking engine — siguen en §4.4 (post-MVP).
- IA V1 completa (copiloto NA con anomaly detection, voice-first end-to-end, visión por computadora) — fase 6 del roadmap.
- Multi-property en un solo tenant — un tenant = un hotel hasta validar el primer cliente.
- Self-service onboarding — el alta del piloto es manual y asistida.

---

## 1. Workstreams del sprint

```
┌──────────────────────────────────────────────────────────────────────┐
│  Producción                                                          │
│   - infra/         Fly.io o Railway, Postgres managed, NATS managed  │
│   - secrets        Vault/Doppler, rotación PAIRING_SECRET y JWKS     │
│   - backups        WAL-G + restore drill                             │
│   - observabilidad Grafana + Loki + Alertmanager + on-call           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Onboarding piloto                                                   │
│   - scripts/import-from-csv     (rooms, guests, reservations)        │
│   - scripts/keycloak-bootstrap  ya existe; extender para piloto      │
│   - training material           PDF + video corto por rol            │
│   - SES.HOSPEDAJES live         API key real, primer envío auditado  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Polish del MVP                                                      │
│   - QR SVG inline en /supervisor/pair    (S4 follow-up)              │
│   - Fotos lost-found a S3 con URL firmada (S4 follow-up)             │
│   - HSK MCP tools cableadas al Copilot   (S4 follow-up)              │
│   - Bug bash dirigido (issues abiertos durante UAT)                  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Stretch — IA V1 kickoff                                             │
│   - Heurística HSK assignment   (sugerencia ranked, no auto)         │
│   - tool hsk_suggest_assignments (read-only, auto-exec)              │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios mantenidos sin excepción:**

- ADR-020: ninguna acción mutating se auto-ejecuta — ni siquiera la heurística HSK.
- API-first y MCP-first: lo que aparece en UI primero existe como endpoint y como tool.
- Multi-tenant by default: incluso con un solo cliente, todo pasa por `withTenant`.
- Audit log inmutable: cada acción del piloto queda trazada.
- **Mobile-first** sigue innegociable para HSK.

---

## 2. Workstream 1 — Despliegue producción

### 2.1 Infra

- **Plataforma:** decidir entre Fly.io y Railway (`PROJECT.md` §6 deja ambas como opciones early). Decisión cerrada en W1 con un ADR-023.
- **Postgres:** managed (Neon, Supabase o Fly Postgres). RLS activa, `FORCE` en cada tabla. Backups WAL diferidos a object storage.
- **NATS:** Synadia Cloud o self-hosted en Fly. JetStream con retención 7 días en streams `pms.events.*`.
- **Redis:** Upstash o Fly Redis para BullMQ.
- **Keycloak:** instancia dedicada para producción, separada de staging; realm `pms` con clientes `pms-web`, `pms-hsk`, `pms-api`.
- **Object storage:** S3-compatible (R2, MinIO o Backblaze) para fotos lost-found y exports CSV.

### 2.2 Secrets y rotación

- `PAIRING_SECRET` (HMAC pairing tokens HSK) en vault, rotación documentada (RUNBOOK §14.2).
- `KEYCLOAK_CLIENT_SECRET` por cliente.
- `SES_HOSPEDAJES_API_KEY` para producción Guardia Civil.
- `DATABASE_URL` con read-replica para reportes pesados (W3+).

### 2.3 Observabilidad

Dashboards Grafana provisionados via `infra/grafana/dashboards/*.json`:

| Dashboard | Paneles clave |
|---|---|
| **API health** | p50/p95/p99 latency por endpoint, error rate 5xx, throughput, RLS denials |
| **Night Audit** | Run success rate, duración por step, pasos fallidos, drift business_date |
| **Housekeeping** | Las 9 series `hsk_*` de S4 W5: tasks por status, p95 duration, pairings outcome |
| **Eventbus** | Lag de consumers, deadletters, schema validation errors |
| **Compliance** | SES queue depth, send success rate, retry budget consumido |

Alertas Alertmanager → Slack:

- `error_rate{service="pms-api"} > 0.01` 5m → page on-call.
- `night_audit_run_failed_total > 0` durante 30 min → page on-call.
- `ses_submission_status="FAILED"` rate > 1/h → ticket.
- `histogram_quantile(0.95, hsk_task_duration_minutes) > 90` → revisar checklist housekeeping.
- `rate(hsk_pairings_redeemed_total{outcome="not_found"}[5m]) > 0.5` → posible enumeration.

### 2.4 Backups y DR drill

- WAL-G dump cada 6h al object storage. Snapshot diario + retención 30 días.
- **DR drill obligatorio antes de pasar al piloto:** restaurar a un cluster paralelo y validar reservas/folios coinciden.

---

## 3. Workstream 2 — Onboarding del piloto

### 3.1 Importación de datos

Script `scripts/import-piloto.ts`:

- Lee CSV de habitaciones, huéspedes activos, reservas in-house, rate plans.
- Valida con los mismos Zod schemas de los services.
- Inserta vía `withTenant` (RLS aplica).
- Idempotente sobre `(tenantId, externalId)`.
- Genera reporte de filas saltadas con motivo.

### 3.2 Bootstrap Keycloak para el piloto

Extiende `scripts/keycloak-bootstrap.ts` para crear los users del piloto desde un YAML:

```yaml
tenant: aubergine-piloto-bcn
users:
  - email: maria@hotel.local
    fullName: María García
    roles: [tenant_admin, front_desk]
  - email: paco@hotel.local
    fullName: Paco Ruiz
    roles: [housekeeping_supervisor]
  - email: ana@hotel.local
    fullName: Ana López
    roles: [housekeeper]
```

### 3.3 Material de formación

- PDF de 4 páginas por rol (front desk, supervisor, camarera) con screenshots.
- Vídeo corto (5-8 min) por flujo principal: check-in, cierre nocturno, asignación de turno HSK.
- Hosteado en `docs/training/` y enlazado desde la home de cada PWA.

### 3.4 SES.HOSPEDAJES en producción

- Pedir al hotel sus credenciales reales (operador SOS).
- Setear `SES_HOSPEDAJES_ENDPOINT` y `SES_HOSPEDAJES_API_KEY` apuntando a producción.
- Primer envío manual con un huésped de prueba real, confirmación visual del acuse.
- Activar el job recurrente.

---

## 4. Workstream 3 — Polish del MVP

### 4.1 QR SVG inline en `/supervisor/pair`

S4 W4 dejó el flujo con código de 12 chars + deep link, pero sin imagen QR. Sprint 5 W2 añade `qrcode` (lib server-side, ~50 kB) y renderiza el SVG inline en la página supervisor. La camarera escanea con la cámara nativa de su móvil → el navegador abre `/login/qr?tenantId=X&code=Y` → redime automáticamente.

### 4.2 Fotos Lost & Found en S3

Las fotos viven inline (`photoBase64`) desde S4 W3 — funciona, pero infla el row size. Migración:

1. Nueva columna `photo_url` (TEXT, nullable).
2. `LostFoundService.register()` sube a S3 si está configurado, devuelve URL firmada con expiración 90d. Si no, sigue base64 (entornos sin S3 — dev local, tests).
3. Migrar las filas existentes con un script `scripts/migrate-lost-found-to-s3.ts`. La columna `photo_base64` se mantiene durante 1 release para rollback; se borra en S5 W5.
4. Frontend muestra `photo_url` con preferencia sobre `photo_base64`.

### 4.3 HSK MCP tools al Copilot

S4 W4 entregó las 4 tools (`hsk_assign_task`, `hsk_start_task`, `hsk_complete_task`, `hsk_list_today`) con su router, pero el Copilot conversacional aún solo conoce el catálogo FO. Sprint 5 cablea:

1. `CopilotService` acepta tool names de cualquier dominio. Internamente delega al router correcto (`FoToolRouter` o `HskToolRouter`) según el prefijo (`hsk_*` → HSK, resto → FO).
2. `proposeReply()` (stub o Anthropic) ahora reconoce intents HSK: "asigna habitación 305 a María para mañana", "qué tareas tiene Ana hoy".
3. UI del copilot deja de filtrar por dominio — muestra cualquier tool sugerida.
4. Confirmación humana sigue siendo obligatoria para mutating (ADR-020).

### 4.4 Bug bash dirigido

Issue tracker abierto durante UAT del Sprint 4 (paper cuts). W3-W4 dedica medio sprint a cerrarlos, priorizando:

- Loading states y spinners donde falten.
- Mensajes de error en español, claros y accionables (no stack traces).
- Validación frontend antes de hit al servidor (UUIDs, fechas).
- A11y básica (focus management, aria-labels en botones-icono).
- Performance: lazy load de imágenes lost-found, code-splitting de `/supervisor`.

---

## 5. Workstream 4 — Stretch IA V1

### 5.1 Heurística HSK assignment

`packages/mcp-tools/src/catalog/hsk.ts` añade un quinto tool, **read-only**:

```ts
hsk_suggest_assignments: {
  name: 'hsk_suggest_assignments',
  description: 'Sugiere una asignación de tareas HSK del día a las camareras disponibles, balanceando carga y duración predicha.',
  inputSchema: hskSuggestAssignmentsInput,  // { propertyId, businessDate }
  mutating: false,
  financial: false,
}
```

Implementación V1 (sin ML; heurística interpretable):

1. Lista las tareas PENDING del día sin asignar.
2. Lista las camareras `housekeeper` activas en el property.
3. Por cada camarera, calcula su capacidad estimada del turno (8h * 0.6 productivo = ~290 min).
4. Usa la mediana histórica de `durationMin` por (`taskType`, `room.roomTypeId`) — ya tenemos los datos de S4.
5. Asigna greedy: ordena tareas por planta → rellena la primera camarera hasta su capacidad → siguiente.
6. Devuelve `{ suggestions: [{taskId, suggestedUserId, predictedMin}], unmatched: [...] }`.

El supervisor ve las sugerencias en `/supervisor` con un botón "Aplicar todas" que ejecuta los `reassign` correspondientes (mutating, requiere su confirmación).

### 5.2 Telemetría del modelo

Cada sugerencia aplicada vs ignorada se loggea en una tabla `hsk_assignment_suggestions` (W5 si entra; si no, V2). Permite medir adoption rate y refinar la heurística antes de pasar a un modelo entrenado.

---

## 6. Datos y migraciones nuevas

| Migración | Tablas / cambios | Notas |
|---|---|---|
| `20260603_lost_found_photo_url` | `lost_found_items.photo_url` (TEXT, nullable) | Backfill via script. `photo_base64` se elimina en S5 W5 tras backfill. |
| `20260610_hsk_suggestions` (stretch) | `hsk_assignment_suggestions` (id, run_id, task_id, suggested_user_id, applied) | RLS + audit. Solo si W5 entra. |

Sin nuevas tablas críticas. La columna `photo_url` se sirve directamente de S3 con URL firmada — no se duplica en DB.

---

## 7. Calidad y verificación

- **Unit:** los tests existentes deben mantenerse al verde a lo largo del sprint. Cobertura objetivo se mantiene (sin regresar bajo ≥75% en módulos core).
- **Integration:** spec nuevo para el `CopilotService` cross-dominio (W4). Spec para la heurística HSK (W5 stretch).
- **E2E (Playwright):** test de regresión de los 3 flujos del MVP (FO check-in, NA close, HSK start/complete) corriendo en cada PR contra el staging deploy.
- **DR drill:** scripted, ejecutable bajo demanda. Documentado en RUNBOOK §14.3.
- **UAT real con el hotel piloto** durante W6-W8: la matriz de [`SPRINT-4-UAT.md`](./SPRINT-4-UAT.md) extendida con escenarios FO + NA reales.
- **Carga liviana:** `k6` o `artillery` con 50 reservas concurrentes + 200 GET /reservations. Objetivo p95 < 800 ms en staging con réplica del tamaño del piloto.

---

## 8. Plan por semanas (estimación 6-8 semanas)

| Semana | Producción | Onboarding | Polish | Stretch IA |
|---|---|---|---|---|
| **W1** | ADR-023 plataforma + setup Fly/Railway + Postgres managed | — | — | — |
| **W2** | Secrets vault + Keycloak prod + smoke deploy | Script import-piloto.ts (rooms, guests) | QR SVG inline | — |
| **W3** | Backups + DR drill + dashboards Grafana | SES.HOSPEDAJES live + primer envío real | Fotos lost-found a S3 | — |
| **W4** | Alertmanager → Slack + on-call rota | Material de formación PDF + vídeo | HSK tools al Copilot | — |
| **W5** | Performance baseline + load test | Bootstrap users del piloto + training session | Bug bash dirigido | Heurística HSK V1 |
| **W6** | Hand-over al piloto: go-live | Soporte L1 disponible (Slack compartido) | Hotfixes prioritarios | `hsk_suggest_assignments` en `/supervisor` |
| **W7** | Operativa real, observamos métricas | UAT extendido con datos reales | — | Telemetría adoption |
| **W8** | Cierre del sprint: post-mortem + RUNBOOK §14/§15 | — | — | — |

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| El hotel piloto descubre un bug de datos críticos en su primer día | Media | Alto | Carga el piloto en staging primero con sus datos reales y hace 1 día completo de paralelo (Aubergine + sistema actual) antes del go-live |
| SES.HOSPEDAJES rechaza envíos por formato no validado en sandbox | Media | Alto | UAT en sandbox SES con 50+ partes diversos antes de cambiar al endpoint live; logs detallados en queue |
| Cambios de rotación de `PAIRING_SECRET` invalidan sesiones de camareras a mitad del turno | Baja | Medio | Documentar ventana de rotación (4 AM, post night audit). Aceptar dual-secret durante 12h en `JwtValidatorService` (W1) |
| Latencia inestable Postgres managed cross-region | Media | Alto | Elegir región europea (Fra/Mad) que coincida con el hotel; benchmark latencia cliente↔DB ≤ 30 ms |
| Heurística HSK sugiere algo absurdo (camarera nueva con 50 habitaciones) | Alta | Bajo | Cap explícito por camarera (capacidad turno × 0.8); supervisor revisa, ADR-020; A/B con asignación manual durante 2 semanas |
| Backup restore tarda > 4h | Media | Alto | DR drill mensual; alertar si volumen DB > umbral |
| Service worker de PWA HSK queda cacheado con versión rota | Media | Medio | Versionado SW + `skipWaiting` + página `/clear-cache` que el supervisor puede invocar remotamente |
| Onboarding train-the-trainer no cala — operadores no usan Aubergine | Alta | Alto | Sesión presencial al menos un día; canal Slack/WhatsApp directo con on-call durante las 2 primeras semanas |

---

## 10. Salida de Sprint 5 (handoff a Sprint 6 / IA V1)

- 1 hotel boutique facturando con Aubergine en producción ≥ 14 días.
- Dashboards y alertas calibradas con tráfico real → SLOs validados o ajustados.
- Pipeline de datos limpio: backup, restore, migración entre versiones.
- Catálogo MCP completo (FO + HSK) consumible desde el Copilot único.
- Material de formación reusable para el siguiente hotel.
- Heurística HSK V1 corriendo (stretch); supervisores la consultan y la ajustan.
- Lista priorizada de issues observados durante el piloto que entran en Sprint 6 / IA V1.

**Sprint 6 arrancará con:**

- Copilot operativo cross-dominio con anomaly detection NA (rate overrides raros, descuentos sospechosos).
- Voice-first para camareras (dictado de notas y status).
- Forecasting de pickup / ocupación a 90 días.
- Onboarding del segundo hotel piloto (replicabilidad probada).

---

## 11. Referencias

- [`PROJECT.md`](../PROJECT.md) — documento maestro, §10 fase 5.
- [`docs/SPRINT-4-PLAN.md`](./SPRINT-4-PLAN.md) — Sprint 4 (predecesor).
- [`docs/SPRINT-4-UAT.md`](./SPRINT-4-UAT.md) — base de la matriz de UAT extendida.
- [`RUNBOOK.md`](../RUNBOOK.md) — operaciones (§14 incident response y §15 onboarding aterrizan en W8).
