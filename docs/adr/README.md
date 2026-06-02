# Aubergine PMS · ADR Index

> Architecture Decision Records. Decisiones arquitectónicas que
> sobreviven a la feature que las originó. El proceso vive en
> [`docs/PROCESS.md §5`](../PROCESS.md). El template en
> [`_template.md`](./_template.md).

| # | Título | Status | Date |
|---|---|---|---|
| 030 | [Arquitectura Verifactu (e-invoicing AEAT)](./030-verifactu-architecture.md) | Accepted | 2026-05-29 |
| 031 | [Librería XAdES — xadesjs](./031-verifactu-xades-library.md) | Accepted | 2026-05-29 |
| 032 | [Payload XML Verifactu](./032-verifactu-xml-payload.md) | Accepted | 2026-05-29 |
| 033 | [City tax como NoSujeta en Verifactu](./033-city-tax-nosujeta-verifactu.md) | Accepted | 2026-06-02 |

---

## Numeración

- Próximo número libre: **034**.
- La numeración es global y correlativa, nunca se reutiliza.
- ADR-001 a ADR-029 son históricos previos (no todos están migrados al
  formato actual; los que se necesiten se actualizan caso por caso).

---

## Cómo añadir un ADR

1. Decidir si la decisión merece ADR o basta con RFC
   (ver [`PROCESS.md §5`](../PROCESS.md#5--adr--historial-de-decisiones)).
2. Copiar `_template.md` a `NNN-slug.md`.
3. Rellenar todas las secciones.
4. Abrir PR (puede ir junto al PR de código que lo motiva).
5. Al mergear, actualizar la tabla de arriba.
6. Si supersede a un ADR previo, cambiar el viejo a
   `Superseded by ADR-NNN` en el mismo PR.
