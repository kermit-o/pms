# Sprint 7 — Vision, memoria semántica, voice-first FO, escalado

> **Versión:** 1.0 — 2026-05-16
> **Branch de desarrollo:** workstreams en branches dedicadas (`claude/s7-w<N>-<topic>`).
> **Documento padre:** [`PROJECT.md`](../PROJECT.md) §10 fase 7 (GTM continuo) + Sprint 6 §11 (handoff).
> **Predecesores:** Sprint 6 IA V1 cerrado en código (W1-W5). Track commercial-grade
> (reservations Iter A/B + Stripe Fase 1/2) cerrado.
>
> **Estado:** Sprint 7 ✅ código mergeado en sus 4 ramas:
> `claude/s7-w1-voice-fo`, `claude/s7-w4-seed`, `claude/s7-w2-memory`,
> `claude/s7-w3-cv`. Sin merge a `main` todavía — pendiente validación PO.

---

## 0. Norte estratégico

Sprint 6 entregó la base AI-native: copilot real con audit + métricas, anomaly
detection NA, voice-first HSK, forecasting Holt, copilot embebido con streaming.
El track paralelo commercial-grade cerró reservations v2 + payments end-to-end.

**Sprint 7 amplía la base por las tres dimensiones que faltan para que el SaaS
sea defendible vs Mews/Cloudbeds en demo y operación diaria:**

1. **Voice-first en Front Office**, no solo en housekeeping. La recepcionista
   dicta `"carga 35€ al folio de la 305"` y el sistema lo ejecuta.
2. **Memoria semántica del huésped**. El copilot responde a `"qué pidió Pérez
   la última vez"` mirando histórico (pgvector + RAG sobre cardex + folios).
3. **Visión por computadora en HSK** para inspección post-limpieza.
4. **Onboarding escalado a varios hoteles**, incluido el creador de datos
   sintéticos para validar sin esperar al piloto real.

**Realidad operacional asumida (decisión del PO 2026-05-16):** los hoteles
piloto no están todavía operando con Aubergine. Sprint 7 procede sin esa
gating condition; donde hace falta historial real, generamos datos sintéticos
vía seed.

**Definition of Done de Sprint 7:**

1. **Voice-first FO** funciona en `/folio/[id]` y `/reservations/new`. La
   recepción puede dictar cargos y crear reservas walk-in con frases en
   español (`"carga 35 a la 305"`, `"reserva walk-in para Pérez del 20 al 22
   en una doble"`). Audio nunca sale del browser.
2. **Memoria semántica huésped**: pgvector activo, embeddings de cardex +
   stays generados, nueva tool `recall_guest_history(guestId)` en el catalog,
   copilot la usa cuando el operador pregunta por un huésped.
3. **CV inspección HSK**: pipeline para subir foto post-limpieza, modelo
   (Vision API de Anthropic o un local) clasifica `clean / dirty / damaged`
   con explicación textual, persistido en `housekeeping_tasks.attributes`.
4. **Onboarding multi-hotel**: `scripts/seed-synthetic.ts` crea N hoteles
   con M habitaciones, K reservas históricas realistas (24 meses de
   estacionalidad), 4 tipos de huéspedes con membership levels. Documentado
   en RUNBOOK §17.
5. **CI verde** en las 4 ramas. RUNBOOK §17 (datos sintéticos) y §18 (CV +
   memoria). Tests ≥85% en módulos nuevos (`copilot/memory/`, `cv/`,
   `voice-fo/`).

**Lo que explícitamente NO se entrega:**

- Voice-to-text en idiomas distintos de `es-ES` (V2).
- Procesamiento de audio en servidor (sigue local; CLAUDE.md §11 GDPR).
- CV con modelo propio entrenado (V2 cuando haya 1000+ fotos reales).
- Memoria multimodal — solo texto en V1.
- GTM (sales/partnerships/expansión geográfica) — fuera de scope de Claude
  Code per CLAUDE.md §8.

---

## 1. Workstreams

```
┌──────────────────────────────────────────────────────────────────────┐
│  W1 — Voice-first FO                                                 │
│   - apps/web-fo/src/components/voice-fo-button.tsx                   │
│   - lib/voice-fo-grammar.ts (parser de comandos ES)                  │
│   - Integración en /folio/[id] (cargos) y /reservations/new (walk-in)│
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W2 — Memoria semántica huésped (pgvector + RAG)                     │
│   - extensión pgvector en migration                                  │
│   - guest_embeddings (text chunks de cardex/stays + vector)          │
│   - copilot tool recall_guest_history                                │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W3 — CV inspección HSK                                              │
│   - upload foto post-clean → Claude Vision o equivalente             │
│   - clasificación + razonamiento textual                             │
│   - persistencia en housekeeping_tasks.attributes.inspection         │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  W4 — Seed sintético multi-hotel                                     │
│   - scripts/seed-synthetic.ts (parametrizable)                       │
│   - 24m de historia realista por hotel                               │
│   - Documentado en RUNBOOK §17                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios mantenidos sin excepción** (igual que Sprint 6):

- ADR-020: ningún tool mutating se auto-ejecuta. Cargos por voz proponen, no
  ejecutan.
- API-first y MCP-first.
- Multi-tenant by default — embeddings y modelos calibrados por tenant.
- Audit log inmutable. `copilot_messages` capta cada turno con tokens.
- Mobile-first para HSK.

---

## 2. Workstream 1 — Voice-first FO

### 2.1 Reutilización

Sprint 6 W3 dejó `voice-keywords.ts` + `voice-button.tsx` en `apps/web-hsk`.
W1 generaliza el patrón a `apps/web-fo`:

- Mover el componente base a `packages/shared` si el código diverge poco; si
  no, copia con prefijo `voice-fo-*` (decidir en Discovery del propio W1).
- Idioma `es-ES`, idéntica privacidad (sin servidor).

### 2.2 Gramática

`apps/web-fo/src/lib/voice-fo-grammar.ts`: parser regex puro (sin LLM) que
mapea frases a intents. Cobertura V1:

| Frase                                            | Intent                          |
|--------------------------------------------------|---------------------------------|
| `carga 35€ a la 305`                             | `add_charge(amount, room)`      |
| `cobra 50 en efectivo a la reserva BBM01-XYZ`    | `add_payment(amount, code)`     |
| `reserva walk-in Pérez del 20 al 22 doble`       | `create_walk_in`                |
| `marca la 305 como sucia`                        | `set_room_status` (existe)      |
| `qué tarifa tengo para mañana en doble`          | `query_availability`            |

Para las mutating: el parser produce un *intent draft* que el operador
confirma con un mini-form (mismo patrón que `PendingToolCard` del copilot).

### 2.3 Integración

- `apps/web-fo/src/app/folio/[id]/page.tsx` o componente equivalente: añade
  el botón con `onIntent={...}`.
- `apps/web-fo/src/app/reservations/new/page.tsx`: idem, walk-in.
- Sin tocar backend — todos los intents usan endpoints existentes.

### 2.4 Tests

- Unit del parser (similar a `voice-keywords.spec.ts`, pero ahora en web-fo;
  añadir vitest a web-fo es scope deviation — usar parser en
  `packages/shared` con tests del paquete shared, o test inline con runner
  del API si lo importamos como helper).

---

## 3. Workstream 2 — Memoria semántica huésped

### 3.1 pgvector

Nueva migración: `CREATE EXTENSION IF NOT EXISTS vector;` + tabla
`guest_embeddings`:

```sql
guest_embeddings(
  id uuid PK,
  tenant_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  source_kind text NOT NULL,  -- 'CARDEX' | 'STAY_NOTE' | 'FOLIO_NOTE'
  source_ref text NULL,
  chunk_text text NOT NULL,
  embedding vector(1536) NOT NULL,   -- text-embedding-3-small
  created_at timestamptz DEFAULT now()
)
```

Con índice IVFFlat o HNSW por `(tenant_id, embedding)`.

### 3.2 Ingesta

`apps/api/src/copilot/memory/ingest.service.ts`:

- On guest create/update: chunk de cardex (nombre, doc, nacionalidad, notes,
  attributes JSON ‘aplanado’).
- On reservation close: chunk de stay (rate plan, special requests, notes,
  agencyName/companyName, folio totals).
- Embeddings con `embedding-3-small` (1536 dims, barato).
- Idempotente por `source_kind + source_ref`.

### 3.3 Tool MCP `recall_guest_history`

```ts
recall_guest_history: {
  inputSchema: z.object({
    guestId: z.string().uuid(),
    query: z.string().min(1).max(200),  // "alergias", "preferencias de habitación", ...
    limit: z.number().int().min(1).max(10).default(5),
  }),
  mutating: false,
  financial: false,
}
```

Genera embedding del query, hace KNN sobre `guest_embeddings WHERE tenant_id
= ? AND guest_id = ?`, devuelve top-K chunks con score.

### 3.4 Prompt del copilot

Actualizar el system prompt: cuando el operador pregunta por un huésped
("¿qué pidió Pérez?"), el copilot debe llamar `find_guests_by_name` (existe
o crear) → `recall_guest_history` → responder con contexto.

---

## 4. Workstream 3 — CV inspección HSK

### 4.1 Pipeline

Tarea `IN_PROGRESS` → camarera completa con foto opcional → backend manda
la foto a Claude Vision (o Anthropic `messages.create` con `image` block)
con prompt corto en español:

> Eres un inspector de housekeeping de hotel. Mira la foto y responde
> SOLO con JSON: `{"verdict": "clean"|"dirty"|"damaged", "issues": [string],
> "confidence": 0..1}`.

### 4.2 Persistencia

`housekeeping_tasks.attributes.inspection`:
```ts
{
  verdict: 'clean' | 'dirty' | 'damaged',
  issues: string[],
  confidence: number,
  model: string,
  imageUrl: string,        // S3 firmado (Sprint 5 stretch ya existe)
  reviewedAt: ISO8601,
}
```

Si `verdict === 'damaged'`, el supervisor recibe alerta y la tarea queda
`COMPLETED` pero la habitación pasa a `OOO`.

### 4.3 Endpoint

`POST /hsk/tasks/:id/inspect` con body `{ imageBase64: string }`. Devuelve
el objeto inspection. Idempotente (segundo upload sobreescribe).

### 4.4 Dataset sintético

W4 generará 50 fotos de prueba (`infra/test-fixtures/hsk-photos/*`) con
variantes clean/dirty/damaged etiquetadas. Sirve para tests + demo sin
necesidad de fotos reales hasta que el piloto las acumule.

---

## 5. Workstream 4 — Seed sintético multi-hotel

### 5.1 Script

`scripts/seed-synthetic.ts`:

```bash
pnpm tsx scripts/seed-synthetic.ts \
  --tenant <id> \
  --properties 3 \
  --rooms-per-property 40 \
  --history-months 24 \
  --reservations-per-month 200
```

Genera:

- Tenant (si no existe).
- N properties con M habitaciones (mix realistic: 50% DBL, 25% IND, 15% TWN,
  10% SUP/SUI).
- Catálogo de tipos + rate plans coherente.
- Huéspedes únicos con nombres ES realistas (FakerJS ya está en deps?).
- Reservas distribuidas con estacionalidad (alta en julio-agosto, baja en
  enero-febrero).
- Folio entries (room charge + tax) por noche.
- Cardex GDPR-correcto.
- Algunos huéspedes con `membershipLevel = 'Gold'/'Platinum'/'VIP'`.

### 5.2 Idempotencia

`--reset` borra y rehace; sin flag, salta si ya existe (busca por
`tenantId + propertyId`). Útil para iterar localmente.

### 5.3 RUNBOOK §17

Documenta cómo correr el script, qué datos genera, cómo limpiarlo. Pone
límites: NO correr en prod (verificación por env var).

---

## 6. Datos y migraciones nuevas

| Migración                              | Contenido                                       |
|---------------------------------------|-------------------------------------------------|
| `2026MMDD_pgvector_guest_embeddings`  | `CREATE EXTENSION vector;` + `guest_embeddings` |

CV no necesita migración (campo `attributes` JSONB existe en `housekeeping_tasks`).

---

## 7. Orden de ejecución sugerido

1. **W1 Voice-first FO** — más directo, infra del W3 ya existe.
2. **W4 Seed sintético** — desbloquea testing realista de W2 y W3 (memoria
   sin datos no demuestra nada).
3. **W2 Memoria semántica** — corre con datos del W4.
4. **W3 CV inspección** — el más experimental; cierra Sprint 7.

---

## 8. Salida de Sprint 7 (handoff a Sprint 8)

Si los 4 workstreams cierran, S7 deja Aubergine con:

- Voice-first end-to-end (FO + HSK).
- Memoria del huésped funcional.
- Inspección visual automatizada.
- Dataset sintético reproducible para demos y testing.

**Sprint 8 arrancará con:**

- Channel Manager (SiteMinder o equivalente). Inevitable para escalar venta.
- IBE (Online Booking Engine) propio si el cliente lo prioriza sobre
  Channel Manager (PROJECT.md §4.4 + decisión SaaS del 2026-05-16).
- Modelo CV local (no Claude Vision) cuando el dataset real exista.
- Onboarding wizard self-service (sin script).

GTM (PROJECT.md §10 fase 7) corre en paralelo — fuera de scope Claude Code.
