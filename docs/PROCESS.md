# Aubergine PMS · PROCESS.md

> Este documento define el **flujo de cambio**: cómo una idea pasa de
> "necesitamos esto" a "está en producción y registrado". El objetivo no
> es burocracia — es **no volver a salirnos del objetivo** (PMS real para
> hoteles boutique en España, ver `docs/prd/000-aubergine-master.md`).
>
> Si una propuesta no encaja en este flujo, no encaja en el repo.

---

## 0 · El flujo

```
   ┌─────┐    ┌───────────┐    ┌──────────┐    ┌────────┐    ┌─────┐
   │ PRD │ ─► │ RFC / TDD │ ─► │ Revisión │ ─► │ Código │ ─► │ ADR │
   └─────┘    └───────────┘    └──────────┘    └────────┘    └─────┘
   PM/PO       Arquitecto       Equipo          Producción    Historial
```

| Paso | Responsable | Output | Vive en |
|---|---|---|---|
| 1. PRD | PO | `docs/prd/NNN-slug.md` | `docs/prd/` |
| 2. RFC/TDD | Ingeniero | `docs/rfc/NNN-slug.md` | `docs/rfc/` |
| 3. Revisión | Equipo | Aprobación en PR del RFC | GitHub PR |
| 4. Código | Ingeniero | PRs de implementación | `apps/`, `packages/` |
| 5. ADR | Quien decida | `docs/adr/NNN-slug.md` | `docs/adr/` |

Cada paso tiene una **puerta** (gate) antes de pasar al siguiente.
Saltar una puerta es lo que nos hizo perder semanas y dinero antes.

---

## 1 · PRD — Product Requirements Document

**Responsable:** PO (Outman). Claude Code puede redactar el borrador,
pero el PO firma.

**Cuándo se escribe:** antes de cualquier RFC. Si una idea no tiene PRD,
no se diseña; si no se diseña, no se codifica.

**Qué responde:**

- ¿Qué problema del hotelero resuelve esto?
- ¿Para qué tipo de hotel? (boutique 30-150 hab, rural, ciudad, etc.)
- ¿Qué resultado mide el éxito?
- ¿Cuáles son los criterios de aceptación funcionales?
- ¿Qué queda explícitamente FUERA del alcance?

**Qué NO responde:**

- Tecnología, librerías, esquema de BD, endpoints. Eso es del RFC.

**Plantilla:** `docs/prd/_template.md`
**Numeración:** `001-`, `002-`, ... (correlativa, nunca se reutilizan).
**Estado:** `Draft → Reviewed → Approved → Shipped → Superseded`.

**Gate para pasar a RFC:**

- [ ] Estado = `Approved`
- [ ] PO ha firmado en la sección "Firma"
- [ ] Hay un slot en `docs/prd/000-aubergine-master.md` que lo justifica
      (no se construyen cosas fuera del PRD maestro sin actualizarlo).

---

## 2 · RFC / TDD — Technical Design Document

**Responsable:** Ingeniero (humano o Claude Code). Un PRD aprobado
puede tener uno o varios RFCs si la implementación es grande.

**Cuándo se escribe:** después de un PRD aprobado, antes de empezar a
codificar la feature.

**Qué responde:**

- ¿Cómo se construye? (servicios, modelos Prisma, eventos NATS, UI)
- ¿Qué impacto tiene en la BD? (migraciones, RLS, índices)
- ¿Qué impacto tiene en otros módulos? (contratos, eventos)
- ¿Qué riesgos hay? (concurrencia, performance, multitenancy, compliance)
- ¿Qué alternativas se descartaron y por qué?
- ¿Qué tests cubren el cambio?
- ¿Cómo se hace rollout? (feature flag, migración en N pasos, etc.)

**Qué NO responde:**

- "Por qué hacemos esto" — eso ya está en el PRD. El RFC se centra en el
  *cómo*.

**Plantilla:** `docs/rfc/_template.md`
**Numeración:** `001-`, `002-`, ... (correlativa, independiente de la
de PRDs).
**Estado:** `Draft → In Review → Approved → Implementing → Shipped → Superseded`.

**Gate para pasar a Revisión:**

- [ ] PRD referenciado existe y está `Approved`
- [ ] Secciones obligatorias rellenadas (ver template)
- [ ] No introduce dependencias externas no aprobadas (ver CLAUDE.md §8)
- [ ] No cambia el stack (ver CLAUDE.md §3) sin ADR específico

---

## 3 · Revisión y aprobación del equipo

**Responsable:** equipo (hoy: PO + Claude Code). En el futuro: ≥ 2
revisores humanos cuando haya equipo.

**Cómo se hace:**

1. El RFC se sube en un PR contra `main`: `docs/rfc/NNN-slug.md`.
2. El PR queda abierto hasta que el RFC tenga aprobación.
3. La revisión usa `docs/REVIEW-CHECKLIST.md` como guía.
4. Si hay desacuerdo en una decisión, se anota en la sección
   "Alternativas consideradas" del RFC y se cierra con voto del PO.
5. Aprobado el RFC, se mergea su PR (solo el documento).

**Importante:** se aprueba el RFC, no el código. El código viene después
en PRs independientes que **referencian el RFC** en cada commit.

**Gate para pasar a Código:**

- [ ] PR del RFC mergeado en `main`
- [ ] Estado del RFC = `Approved`
- [ ] PO ha firmado en la sección "Firma"
- [ ] Existe issue/tarea con scope claro y vinculada al RFC

---

## 4 · Código en producción

**Responsable:** Ingeniero implementador.

**Cómo se hace:** según `CLAUDE.md §6, §12`.

- Branch: `claude/<topic-slug>` o `feat/<topic-slug>`.
- PR por unidad de trabajo (no kitchen-sink PRs).
- Cada commit del PR cita el RFC: `feat(folio): multi-folio (RFC-007 §3.2)`.
- DoD (`CLAUDE.md §6.3`) obligatorio antes de merge.
- Entrada en `docs/DELIVERY-LOG.md` cuando se cierra.

**Gate para considerar la feature "en producción":**

- [ ] Mergeado en `main`
- [ ] Desplegado en Fly (`pms-api`, `pms-web-fo`, `pms-web-hsk` según
      aplique)
- [ ] Smoke test manual en el entorno desplegado
- [ ] Entrada en `DELIVERY-LOG.md`
- [ ] Estado del RFC actualizado a `Shipped`

---

## 5 · ADR — Historial de decisiones

**Responsable:** quien tomó la decisión (PO o ingeniero senior). Claude
Code puede redactar el borrador.

**Cuándo se escribe un ADR (y no solo un RFC):**

Un RFC cubre el *cómo* de **una feature**. Un ADR captura una **decisión
arquitectónica transversal** que sobrevive a la feature: una elección de
tecnología, una restricción de seguridad, una convención que afecta a
múltiples módulos por años.

Regla práctica:

- ¿Si esto se olvida en 6 meses, el siguiente ingeniero va a repetir
  el mismo error o reabrir el mismo debate? → **ADR**.
- ¿Es específico de una feature y no constriñe decisiones futuras? →
  basta con el **RFC**.

**Ejemplos que merecen ADR:**

- "Usamos `xadesjs` y no `node-forge` para XAdES-BES" (ADR-031).
- "Postgres con RLS por `tenant_id` para multitenancy" (debería existir).
- "Fly.io región `cdg` primaria, `fra` DR" (ADR-023).

**Ejemplos que NO merecen ADR (basta RFC):**

- "Endpoint `POST /folios/:id/charges` recibe este DTO".
- "Migración añade columna `taxRate` a `FolioEntry`".

**Plantilla:** `docs/adr/_template.md`
**Numeración:** correlativa, nunca se reutiliza. Hoy vamos por ADR-033.
**Estado:** `Proposed → Accepted → Superseded → Deprecated`.

**Cuándo se crea:**

- Junto al PR que la implementa (lo normal en Aubergine hoy).
- Antes del PR cuando la decisión condiciona el diseño (raro).
- Después de un incidente postmortem que cambia una práctica.

---

## 6 · Reglas anti-drift

Estas reglas existen porque ya nos pasó. No son opcionales.

1. **No se codifica sin RFC aprobado**, salvo:
   - Bug fixes (área < 5 archivos, sin cambio de contrato).
   - Refactors internos a un módulo (sin cambio de API ni schema).
   - Cambios de docs / CI / formatting.
2. **No se hace RFC sin PRD aprobado**, salvo los mismos casos que arriba.
3. **No se cambia el stack** (CLAUDE.md §3) sin ADR específico.
4. **No se construye fuera del PRD maestro** sin actualizarlo primero.
   Si una idea no encaja en los 14 bloques del PRD maestro, primero se
   amplía el maestro y luego se hace el PRD específico.
5. **Cada PR cita su RFC** en al menos un commit. Si no hay RFC, el PR
   cae en una de las excepciones del punto 1 y lo justifica en la
   descripción.
6. **El estado de PRD/RFC se actualiza al mergear**, no después. Si se
   mergea código sin actualizar estados, está incompleto.
7. **Ejecución de un RFC aprobado es autónoma.** Una vez el PO firma un
   RFC con su "Plan de trabajo" (sección §11 del template), Claude Code
   recorre los PRs sin pedir confirmación entre uno y otro. Sólo pausa
   y pregunta al PO cuando:
   - Aparece una decisión no cubierta por PRD ni RFC.
   - Una dependencia externa bloquea (cert, credencial, alta AEAT).
   - Un PR requiere ampliar el alcance del RFC.
   - Tests/typecheck/lint fallan por causa que Claude no puede resolver.
   El PO revisa el resultado final al cerrar el RFC, no PR a PR.

---

## 7 · Mapping con CLAUDE.md y PROJECT.md (cuando exista)

- `CLAUDE.md` = contrato Claude ↔ humano. No cambia salvo PR explícito.
- `PROCESS.md` (este) = cómo se mueve el trabajo. Lo lees al empezar
  cualquier feature nueva.
- `docs/prd/000-aubergine-master.md` = qué queremos construir (los 14
  bloques). Se actualiza cuando una nueva área entra en alcance.
- `docs/prd/NNN-*.md` = PRD por feature.
- `docs/rfc/NNN-*.md` = diseño técnico por feature.
- `docs/adr/NNN-*.md` = decisiones arquitectónicas que perduran.
- `docs/DELIVERY-LOG.md` = qué hicimos y cuándo.
- `docs/SPRINT-N-PLAN.md` = el sprint actual ata los PRDs/RFCs activos.

---

_Última actualización: 2026-06-01_
_Maintainer: este documento se actualiza vía PR igual que cualquier otro._
