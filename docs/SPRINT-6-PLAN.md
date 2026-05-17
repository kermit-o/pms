# Sprint 6 — IA V1 completa (Aubergine)

> **Versión:** 1.0 — 2026-05-07
> **Branch de desarrollo:** `claude/sprint-6-ia-v1`
> **Documento padre:** [`PROJECT.md`](../PROJECT.md) §10 fase 6 + §7 (estrategia IA).
> **Predecesores:** Sprint 5 (Piloto + IA V1 stretch) cerrado documentalmente. MVP completo (FO + NA + HSK) facturando — el smoke deploy real y UAT ≥14 días son requisitos previos al inicio de S6 (operacional).

---

## 0. Norte estratégico

Sprint 5 cerró el círculo MCP (FO + HSK cross-domain, `hsk_suggest_assignments`, infra Fly.io productiva, observabilidad y RUNBOOK §14/§15). Sprint 6 **transforma esa base de tools en agentes que entregan valor diferencial vs Mews/Cloudbeds/Apaleo**.

PROJECT.md §7 marca el moat: cada acción ya es una tool MCP. Sprint 6 conecta el modelo real (Anthropic), añade los counters/anomalías que las tools nuevas necesitan, e introduce voz para la PWA HSK. Mantiene ADR-020 — ningún cambio escapa de la confirmación humana.

**Definition of Done de Sprint 6:**

1. **Anthropic adapter real** sustituye al stub determinístico cuando `ANTHROPIC_API_KEY` está set. Modelo Claude Sonnet o Haiku con prompt-caching para el catálogo de tools.
2. **Anomaly detection NA**: el cierre nocturno emite alertas cuando rate overrides, descuentos o duplicados sobrepasan umbrales históricos. Counters expuestos en Prometheus → dashboard `night-audit.json` activo. La alerta `NightAuditAnomalyDetected` llega a Slack.
3. **Voice-first HSK** (PWA web-hsk): la camarera dicta la nota o el room status con un botón "voz" en `/task/[id]`. Web Speech API en el browser → texto → a la API. Fallback: si el browser no soporta, el botón se oculta.
4. **Forecasting embebido**: tool `forecast_demand` devuelve pickup/ocupación/ADR a 30/60/90 días con un modelo simple (ARIMA o exponential smoothing sobre el histórico). Read-only, auto-ejecuta. Visualizado en `/dashboard` del FO.
5. **Reservation copilot** integrado en `/reservations/new` y `/calendar`: el operador puede pedir "reserva walk-in para Juan Pérez del 10 al 12" y el copilot propone con botón confirmar (mutating, ADR-020).
6. **2º hotel piloto** onboarded en producción siguiendo `RUNBOOK §15`. Las métricas Grafana del 1er piloto son la baseline para validar SLOs en multi-tenant real.
7. **Sprint completo:** CI verde, RUNBOOK §16 (operativa IA + cómo desactivar agentes), tests >85% en módulos `copilot/`, `night-audit/anomaly/`, `housekeeping/voice/`.

**Lo que explícitamente NO se entrega:**

- Visión por computadora para inspección post-limpieza (V2 IA — modelo entrenado sobre dataset de fotos lost-found, fuera de scope).
- Memoria semántica del huésped persistente (V2 — Pinecone/pgvector + RAG).
- Voice-first end-to-end en FO (Sprint 7+ si el hotel piloto lo pide; en S6 sólo HSK).
- Detección de fraude de tarjetas (V2 — necesita integración con stripe radar o similar).
- Mantenimiento predictivo (V2 — necesita dataset IoT que no tenemos).
- 3er hotel piloto. Validamos con 2.

---

## 1. Workstreams

> **Estado:** W1 ✅ código mergeado en `claude/copilot-w1-close` (Anthropic adapter,
> prompt caching, audit table, métricas, SSE phase events). W2 ✅ código mergeado
> en `claude/na-w2-anomalies` (detección 4 reglas V1, step DETECT_ANOMALIES,
> métricas, UI revisión, dashboard, alerta). W3 ✅ código mergeado en
> `claude/hsk-w3-voice` (Web Speech API en /task/[id], parser de palabras-clave
> ES, audio nunca sale del browser). W4-W5 pendientes.

```
┌──────────────────────────────────────────────────────────────────────┐
│  W1 ✅ Anthropic adapter (FO + HSK + NA)                              │
│   - apps/api/src/copilot/anthropic-adapter.ts                        │
│   - Tool calling + prompt caching del catálogo (ephemeral)           │
│   - SSE phase events en POST /messages?stream=true                   │
│   - Audit en tabla copilot_messages + métricas Prometheus            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Anomaly detection (NA)                                              │
│   - night-audit/anomaly.service.ts                                   │
│   - Rolling window 30d en Postgres + reglas Z-score                  │
│   - Counters Prometheus + dashboard night-audit.json activo          │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Voice-first HSK (PWA)                                               │
│   - apps/web-hsk: Web Speech API en /task/[id]                       │
│   - Idioma "es-ES", fallback a teclado                               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Forecasting (FO)                                                    │
│   - night-audit/forecast.service.ts (ARIMA simple)                   │
│   - Tool MCP forecast_demand (read-only, auto-exec)                  │
│   - Panel en /dashboard del web-fo                                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  Reservation copilot embebido                                        │
│   - /reservations/new + /calendar exponen el chat lateral            │
│   - Mismo CopilotService/ToolResolver del piloto                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios mantenidos sin excepción:**

- ADR-020: ningún tool mutating se auto-ejecuta. Cada anomalía detectada es una sugerencia, no una corrección automática.
- API-first y MCP-first.
- Multi-tenant by default — los modelos de forecasting y anomaly se entrenan/calibran por tenant.
- Audit log inmutable.
- Mobile-first para HSK.

---

## 2. Workstream 1 — Anthropic adapter real

### 2.1 Adapter

`apps/api/src/copilot/anthropic-adapter.ts`:

- Cliente Anthropic SDK (`@anthropic-ai/sdk`).
- Modelo por defecto: **Claude Haiku 4.5** (latencia y coste). El operador puede subir a Sonnet via `COPILOT_MODEL=claude-sonnet-4-6`.
- **Prompt caching** activo en el system prompt + el catálogo de tools (5 min TTL). Reduce el coste a ~10% del nominal en sesiones largas.
- Tool calling: `tools: foCatalog ∪ hskCatalog` con su `inputSchema` traducido a JSON Schema.
- Streaming: la API expone SSE en `POST /copilot/sessions/:id/messages?stream=true`. El frontend renderiza tokens según llegan.

### 2.2 Trazabilidad

Cada llamada al modelo se loggea en `copilot_messages` (nueva tabla):

```sql
CREATE TABLE copilot_messages (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'tool_use' | 'tool_result'
  content_text TEXT,
  tool_name TEXT,
  tool_input JSONB,
  tool_result JSONB,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Permite auditoría legal (quién pidió qué) + observabilidad de coste (token usage por tenant).

### 2.3 Counters Prometheus

- `copilot_messages_total{tenant, role, model}`
- `copilot_tokens_total{tenant, model, kind=input|output|cache_read}`
- `copilot_latency_seconds{tenant, model}` (histograma)

Dashboard `copilot.json` nuevo con KPIs: msgs/min, p95 latencia, tokens consumidos / día, coste estimado.

### 2.4 Switch de fallback

Variable `COPILOT_DRIVER` ∈ `{anthropic, stub}`. Default `anthropic` si `ANTHROPIC_API_KEY` está set, `stub` si no. Tests siguen usando `stub`.

---

## 3. Workstream 2 — Anomaly detection NA

### 3.1 Detección

`apps/api/src/night-audit/anomaly.service.ts`:

- Se ejecuta como **paso 5.5** del pipeline NA (entre `SNAPSHOT_REPORTS` y `CLOSE_DAY`). No bloquea el cierre — solo emite señales.
- Reglas V1:

| Métrica                                                     | Algoritmo                                           | Severidad |
| ----------------------------------------------------------- | --------------------------------------------------- | --------- |
| Rate override > 30% del BAR                                 | Z-score sobre 30d, `\|z\| > 3`                      | high      |
| Descuento > 50% en una reserva                              | Threshold absoluto + comparado con histórico tenant | medium    |
| Cargo duplicado (mismo `idempotency_key` resuelto distinto) | Match exacto en `folio_entries`                     | critical  |
| Más de 3 cancelaciones same-day del mismo huésped           | Count en window                                     | medium    |
| Variation in `cash_drawer.actual` vs `expected` > 5%        | Threshold                                           | high      |

- Cada anomalía → fila en `night_audit_anomalies` (nueva tabla) + evento `night_audit.anomaly_detected v1` + counter `night_audit_anomalies_total{tenant, kind, severity}`.

### 3.2 Dashboard + alerta

- `infra/grafana/dashboards/night-audit.json` cubre el panel ya documentado en `infra/grafana/README.md` (S5 W3 lo dejaba como bloqueado por counters).
- Nueva alerta: `NightAuditAnomalyDetected` (severity=ticket) — Slack en `#aubergine-incidentes`, no page (la fricción humana de revisar todas las noches es alta).

### 3.3 UI revisión

`apps/web-fo/src/app/night-audit/anomalies/page.tsx`: lista las anomalías del día con un botón "marcar revisada" (PATCH `night_audit_anomalies/:id`). El supervisor del hotel decide si actuar o ignorar — **no se auto-corrige nada** (ADR-020).

---

## 4. Workstream 3 — Voice-first HSK

### 4.1 Web Speech API

`apps/web-hsk/src/app/task/[id]/voice-button.tsx` (`'use client'`):

- Usa `window.SpeechRecognition` o `webkitSpeechRecognition` (iOS Safari).
- Idioma `es-ES`. Continuous=true, interim=true para feedback visual.
- Botón flotante grande (`fixed bottom-6 right-6`) que pinta el waveform mientras escucha.
- Output → input del campo "notas" del formulario de complete; o si dice "marca como CLEAN/DIRTY/INSPECTED", auto-selecciona el room status.
- Si el browser no soporta (raro pero ocurre en builds antiguos de Chrome embebido), el botón se oculta.

### 4.2 Privacidad

El audio se procesa **solo en el browser** — no se sube a un servidor, no se guarda. La nota textual sí se envía a la API normal. El RUNBOOK §16 lo documenta.

### 4.3 Tests E2E

Playwright con `--enable-features=WebSpeechAPI` y un fake stream WAV simula el dictado. Verifica que el texto reconocido aparece en el campo y que el room status auto-selecciona cuando se dice la palabra clave.

---

## 5. Workstream 4 — Forecasting

### 5.1 Servicio

`apps/api/src/night-audit/forecast.service.ts`:

- Dependencia: `simple-statistics` (1.6 MB, MIT). Suficiente para EWMA y regresión lineal.
- Modelo V1: `Holt-Winters` (triple exponential smoothing) sobre la serie histórica de:
  - `occupancy_pct` (snapshots NA)
  - `adr` (snapshot manager)
  - `revpar`
  - `pickup` (reservas creadas con arrival = D)
- Granularidad: día. Horizonte: 90 días.
- Calibración: ventana de entrenamiento 365d si hay datos, fallback 90d si nuevo, fallback "esto no se puede predecir" si <30 puntos.

### 5.2 Tool MCP `forecast_demand`

```ts
forecast_demand: {
  inputSchema: z.object({
    propertyId: z.string().uuid(),
    horizon: z.number().int().min(7).max(90).default(30),
    metric: z.enum(['occupancy', 'adr', 'revpar', 'pickup']).default('occupancy'),
  }),
  mutating: false,
  financial: false,
}
```

Devuelve `{ series: [{ date, predicted, lower, upper }], rmse, mape }`.

### 5.3 UI

`apps/web-fo/src/app/dashboard/forecast/page.tsx`: gráfico de la serie con bandas de confianza. Filtros por property + metric + horizonte.

---

## 6. Workstream 5 — Reservation copilot embebido

### 6.1 Chat lateral

`apps/web-fo/src/components/copilot-drawer.tsx`: drawer fijo a la derecha en `/calendar` y `/reservations/new`. Mismo CopilotService de S5.

Intents nuevos en el adapter Anthropic (catálogo FO ya existe):

- "reserva walk-in para Juan Pérez del 10 al 12 en una doble estándar" → `create_reservation` (mutating).
- "muéveme la reserva R-1234 a la 305" → `assign_room` (mutating).
- "qué tarifa tengo para la 305 mañana" → `query_availability` (read).

### 6.2 Streaming en frontend

`apps/web-fo/src/lib/copilot-stream.ts`: helper sobre `EventSource` que parsea los SSE chunks del adapter Anthropic. Token-by-token render.

### 6.3 Confirmación inline

Cuando el copilot propone un mutating, la UI del drawer muestra un mini-formulario read-only con los args + botón "Confirmar y ejecutar" (lo que hoy es `confirmTool(approve)` via REST). Inline, sin modal.

---

## 7. Datos y migraciones nuevas

| Migración                            | Contenido                                                        | Notas                      |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------- |
| `20260801_copilot_messages`          | tabla `copilot_messages` con audit + token counters              | RLS + audit log            |
| `20260815_night_audit_anomalies`     | tabla `night_audit_anomalies` + enum `night_audit_anomaly_kind`  | RLS + audit                |
| `20260830_forecast_models` (stretch) | tabla `forecast_model_runs` (params + RMSE) si decidimos cachear | Solo si justifica el cache |

Indexado obligatorio: `(tenant, session_id, created_at DESC)` en `copilot_messages`; `(tenant, property_id, business_date)` en `night_audit_anomalies`.

---

## 8. Calidad y verificación

- **Unit:** Vitest en cada nuevo service. Cobertura objetivo ≥85% en `copilot/anthropic`, `night-audit/anomaly`, `night-audit/forecast`.
- **Integration:** spec que ejecuta NA con un dataset sintético que dispara ≥3 anomalías → verifica counters + filas + evento.
- **E2E (Playwright):**
  - FO: drawer copilot crea reserva walk-in con 1 clic de confirmación.
  - HSK: botón voz dicta "marca como CLEAN" → room status se autoselecciona.
  - FO: dashboard forecast muestra serie 30d.
- **CI:** mantiene los 5 jobs (format / lint / typecheck / test / build).
- **Coste:** smoke contra Anthropic en staging para asegurar que el prompt caching funciona (ratio cache_read/input > 0.5 tras 5 mensajes).

---

## 9. Plan por semanas (estimación 6-8 semanas)

| Semana | Foco principal                                          | Entregable                                                      |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------- |
| **W1** | Anthropic adapter + `copilot_messages` table + counters | Stub reemplazado en staging; coste/latencia visibles en Grafana |
| **W2** | Streaming SSE + frontend FO drawer                      | Reserva walk-in con copilot end-to-end                          |
| **W3** | Anomaly detection: 3 reglas + tabla + evento            | NA emite señales en staging                                     |
| **W4** | Anomaly UI + dashboard NA + alerta Slack                | Director del piloto recibe primera señal real                   |
| **W5** | Forecasting: Holt-Winters + tool MCP                    | `forecast_demand` devuelve datos creíbles del piloto            |
| **W6** | Forecasting UI + dashboard FO                           | Director ve pickup 30/60/90d                                    |
| **W7** | Voice-first HSK + tests E2E                             | Camarera dicta nota en una habitación piloto                    |
| **W8** | Onboarding 2º hotel + RUNBOOK §16 + UAT                 | 2 hoteles produciendo en paralelo                               |

---

## 10. Riesgos y mitigaciones

| Riesgo                                                     | Probabilidad | Impacto | Mitigación                                                                                                                 |
| ---------------------------------------------------------- | ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------- |
| Anthropic API rate limits / coste explosivo                | Media        | Alto    | Prompt caching agresivo + límite mensual por tenant + alerta `copilot_tokens_total > X/d`                                  |
| Anomaly detection falsos positivos saturan al supervisor   | Alta         | Medio   | Z-score con `                                                                                                              | z   | >3`(no`>2`). UI permite marcar "ignorar futuras" para una regla específica |
| Voice-first no funciona en el dispositivo del hotel piloto | Media        | Bajo    | Fallback transparente al teclado. Comunicar en formación que es opcional                                                   |
| Forecasting devuelve basura con <90 puntos de histórico    | Alta         | Medio   | Bandas de confianza anchas + mensaje explícito "datos insuficientes, recolecta 30+ días más"                               |
| 2º hotel encuentra bug que el 1º no                        | Media        | Alto    | RUNBOOK §15 ejecutado punta-a-punta; primer hotel actúa de canary durante 1 semana antes del 2º                            |
| Streaming SSE rompe detrás del CDN Cloudflare              | Media        | Medio   | Tests E2E contra staging con CDN. Fallback a polling si Cloudflare buffea                                                  |
| ADR-020 se relaja accidentalmente con los nuevos agentes   | Baja         | Crítico | PR review obligatorio del flujo `mutating + Anthropic` por 2 personas; tests verifican que mutating queue antes de execute |

---

## 11. Salida de Sprint 6 (handoff a Sprint 7)

- 2 hoteles operando con Aubergine en producción ≥ 14 días.
- Copilot conversacional con Anthropic real, cross-domain FO + HSK, streaming visible en UI.
- Anomaly detection NA con 3+ reglas activas.
- Forecasting 30/60/90d disponible en dashboard FO.
- Voice-first HSK funcionando en dispositivo móvil real.
- Métricas IA (token usage, latencia, anomalías detectadas) en Grafana.
- RUNBOOK §16 con operativa IA + cómo desactivar agentes en emergencia.

**Sprint 7 arrancará con:**

- Visión por computadora para inspección post-limpieza (modelo entrenado sobre fotos lost-found acumuladas).
- Memoria semántica del huésped (pgvector + RAG).
- Voice-first FO (cargos por voz tipo "carga 35€ al folio de la 305").
- Onboarding de hoteles 3, 4, 5 — escalado del proceso comercial.

---

## 12. Referencias

- [`PROJECT.md`](../PROJECT.md) §7 (estrategia IA) y §10 (roadmap).
- [`docs/SPRINT-5-PLAN.md`](./SPRINT-5-PLAN.md) — predecesor inmediato.
- [`PROJECT.md` ADR-020](../PROJECT.md#adr-020) — sin auto-ejecución.
- [`PROJECT.md` ADR-023](../PROJECT.md#adr-023) — Fly.io mad.
- [`RUNBOOK.md`](../RUNBOOK.md) §14 (incident response) y §15 (onboarding) — base para §16.
