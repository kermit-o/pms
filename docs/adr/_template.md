# ADR-NNN — Título de la decisión

- **Status:** `Proposed` | `Accepted` | `Superseded by ADR-MMM` | `Deprecated`
- **Date:** YYYY-MM-DD
- **Driver:** ¿qué obliga a tomar esta decisión ahora? (regulación,
  límite técnico, lección de incidente, ...)
- **Related:** RFCs, PRDs, ADRs previos, incidentes postmortem.
- **Sprint:** opcional, si nace dentro de un sprint.

---

## 1 · Contexto

Qué situación hace necesaria la decisión. Sin esto, ¿qué pasa? Por qué
no se puede dejar al juicio caso-a-caso.

---

## 2 · Decisión

La regla, en una frase imperativa. Ejemplo:

> Usamos `xadesjs` (no `node-forge`) para producir firmas XAdES-BES sobre
> los RegistroAlta de Verifactu.

---

## 3 · Consecuencias

### Positivas

- ...

### Negativas / coste asumido

- ...

### Neutras

- ...

---

## 4 · Alternativas descartadas

Por cada una, en una o dos líneas: por qué no.

- **Alternativa A** — descartada porque ...
- **Alternativa B** — descartada porque ...

---

## 5 · Cómo se cumple en el repo

- Archivos / módulos donde vive esta decisión.
- Tests que la protegen.
- Lint rule / CI check si aplica.

---

## 6 · Cuándo revisar

Condición que dispararía un ADR superseding:

- "Si el proveedor X publica una librería oficial".
- "Si pasamos de N tenants a 10×N".
- "Si la regulación cambia el formato del XML".

---

_Plantilla v1 — modificar solo vía PR a `docs/adr/_template.md`._
