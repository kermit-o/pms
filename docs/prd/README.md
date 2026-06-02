# Aubergine PMS · PRD Index

> Product Requirements Documents. Uno por feature o área funcional.
> El proceso vive en [`docs/PROCESS.md`](../PROCESS.md).
> El template está en [`_template.md`](./_template.md).

| # | Título | Status | Bloque maestro |
|---|---|---|---|
| 000 | [Aubergine PMS · Maestro](./000-aubergine-master.md) | Approved | — (es el maestro) |
| 001 | [IVA por línea + City tax en folio](./001-folio-iva-y-city-tax.md) | Shipped | B.6, B.7 |

---

## Cómo añadir un PRD nuevo

1. Comprobar que existe un slot en `000-aubergine-master.md` (uno de los
   bloques A-N con función `❌` o `⚠`). Si no existe, primero ampliar
   el maestro vía PR.
2. Copiar `_template.md` a `NNN-slug.md` con el siguiente número libre.
3. Rellenar el template completo.
4. Abrir PR. El PR queda abierto hasta que el PO firma.
5. Al mergear, actualizar la tabla de arriba y la tabla del bloque
   correspondiente en `000-aubergine-master.md`.
6. Crear el RFC asociado en `../rfc/NNN-slug.md`.
