# RFC-NNN — Título corto

- **Status:** `Draft` | `In Review` | `Approved` | `Implementing` | `Shipped` | `Superseded`
- **Author:** nombre (humano) o "Claude Code"
- **Date:** YYYY-MM-DD
- **PRD:** PRD-NNN (obligatorio)
- **Related:** RFCs / ADRs previos
- **Sprint objetivo:** S?? W??

---

## 1 · Resumen ejecutivo

3-5 líneas. ¿Qué construimos y cómo, en una respiración?

---

## 2 · Contexto técnico

Estado actual de los módulos que se tocan. Qué hay hoy, qué falta, qué
contratos existen. Linkear archivos concretos del repo:
`apps/api/src/folio/folio.service.ts:42`.

---

## 3 · Diseño propuesto

### 3.1 · Modelo de datos

- Tablas Prisma nuevas / modificadas.
- Migración en N pasos si aplica (expand → backfill → contract, ver
  CLAUDE.md §15).
- RLS: política `tenant_id` aplicada a cada tabla nueva.
- Índices obligatorios.

### 3.2 · API / endpoints

- Métodos HTTP, rutas, DTOs (Zod schema).
- Idempotency keys donde proceda.
- Códigos de error esperados.
- Eventos NATS emitidos: subject, payload, garantías de entrega.

### 3.3 · Lógica de servicio

- Servicios nuevos / modificados.
- Invariantes a preservar (saldos, status machine, ...).
- Concurrencia: locks pesimistas, optimistic version, ...

### 3.4 · UI (si aplica)

- Páginas / componentes que se añaden o cambian.
- Server actions vs client components.
- Estados de carga / error.
- Permisos por rol (Keycloak).

### 3.5 · Multitenancy

- Toda query usa `withTenant(ctx, ...)`. Excepciones documentadas.
- Logs, métricas y eventos llevan `tenantId`.

### 3.6 · Compliance

- ¿Toca PCI? (PAN never on our servers.)
- ¿Toca GDPR? (derecho al olvido, portabilidad.)
- ¿Toca SES.HOSPEDAJES, Verifactu, INE?

---

## 4 · Tests

- Unit (lista de archivos `*.spec.ts` nuevos).
- Integration (lista).
- E2E Playwright si toca el flow del usuario (lista).
- Qué NO se testea y por qué.

---

## 5 · Observabilidad

- Logs estructurados (campos clave).
- Métricas OTel nuevas (nombre, tipo, labels, cardinalidad).
- Trazas: spans nuevos relevantes.
- Alertas en Grafana si procede.

---

## 6 · Rollout

- ¿Feature flag? ¿Nombre y default?
- Orden de despliegue (migración → API → web).
- ¿Rollback es seguro? ¿Cómo?
- Comunicación al hotel piloto.

---

## 7 · Riesgos técnicos

Cada uno con su mitigación.

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| ... | ... | ... | ... |

---

## 8 · Alternativas consideradas

Mínimo dos. Por cada una: por qué se descartó.

### 8.1 · Alternativa A

Descripción + pros/contras.

### 8.2 · Alternativa B

Descripción + pros/contras.

---

## 9 · Decisiones que necesitan ADR

Si algo de este RFC introduce una decisión arquitectónica que sobrevive
a la feature (elección de librería, convención transversal, ...), listar
aquí y abrir el ADR correspondiente:

- ADR-NNN — ...

---

## 10 · Dependencias externas

- Librerías nuevas (npm). Justificar coste/licencia/mantenimiento
  (CLAUDE.md §8).
- Servicios SaaS nuevos.
- Datos del PO (cert, credenciales, ...).

---

## 11 · Plan de trabajo

PRs anticipadas, en orden:

1. PR #1 — migración + modelos Prisma
2. PR #2 — servicio + tests
3. PR #3 — controller + DTOs + tests
4. PR #4 — UI
5. PR #5 — docs (RUNBOOK + DELIVERY-LOG)

---

## 12 · Firma

- **Tech reviewer:** _·_
- **PO:** _Outman El Ouary Achi · YYYY-MM-DD_

Sin estas firmas, el RFC no pasa a `Approved` y no se codifica.

---

_Plantilla v1 — modificar solo vía PR a `docs/rfc/_template.md`._
