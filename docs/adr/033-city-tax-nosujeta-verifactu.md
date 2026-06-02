# ADR-033 — City tax como `<NoSujeta>` en Verifactu

- **Status:** `Accepted` (2026-06-02, firma delegada por PO)
- **Date:** 2026-06-02
- **Driver:** RFC-001 §3.6 introduce city tax como cargo separado en el
  folio. Verifactu/AEAT no documenta explícitamente dónde colocar
  impuestos autonómicos no-IVA dentro del XML `RegistroAlta`, pero el
  XML debe cuadrar `ImporteTotal` con la suma desglosada.
- **Related:** RFC-001, ADR-030 (arquitectura Verifactu), ADR-032
  (payload XML), `apps/api/src/verifactu/invoice-xml.ts`.

---

## 1 · Contexto

El folio puede contener tres tipos de cargos fiscales tras RFC-001:

1. **Cargos con IVA repercutido** (ROOM, BREAKFAST, EXTRA_*) → entran
   en el desglose normal con `CalificacionOperacion=S1` y
   `TipoImpositivo` + `BaseImponible` + `CuotaRepercutida`.
2. **City tax** (tasa turística autonómica catalana, balear, valenciana,
   ...) → es un impuesto **no-IVA**, recaudado por el hotel para la
   administración autonómica/municipal. No se factura IVA sobre él.
3. **Exentos** (cortesía, etc.) → ya cubierto por categoría EXEMPT.

La AEAT en su guía Verifactu permite `CalificacionOperacion=N1` para
operaciones "No Sujetas", con `BaseImponibleOimporteNoSujeto` y **sin**
`CuotaRepercutida`. Pero el caso de uso explícito es "operaciones fuera
de territorio IVA" (exportaciones, etc.), no "impuestos paralelos".

Tres alternativas para representar el city tax:

- **A.** `<DetalleDesglose>` con `N1` (NoSujeta) — el city tax aparece
  en el desglose como base sin cuota repercutida. `ImporteTotal`
  cuadra (BaseImponible + Cuota + NoSujeta).
- **B.** Incluir el city tax como una línea más con `S1` y tipo `0%` —
  cuadra el total pero falsea la naturaleza fiscal (no es IVA exento;
  es otro impuesto).
- **C.** No incluir el city tax en el XML AEAT — lo trata el contable
  externamente. `ImporteTotal` no cuadra con el folio real.

---

## 2 · Decisión

Usamos **opción A**: city tax viaja como un `<DetalleDesglose>`
adicional con `CalificacionOperacion=N1` (NoSujeta) y sólo
`BaseImponibleOimporteNoSujeto`. Sin `CuotaRepercutida`.

`ImporteTotal` se calcula como subtotal IVA + cuota IVA + city tax,
preservando que el total facturado coincide con lo cobrado al huésped.

```xml
<Desglose>
  <DetalleDesglose>
    <ClaveRegimen>01</ClaveRegimen>
    <CalificacionOperacion>S1</CalificacionOperacion>
    <TipoImpositivo>10.00</TipoImpositivo>
    <BaseImponibleOimporteNoSujeto>100.00</BaseImponibleOimporteNoSujeto>
    <CuotaRepercutida>10.00</CuotaRepercutida>
  </DetalleDesglose>
  <DetalleDesglose>
    <ClaveRegimen>01</ClaveRegimen>
    <CalificacionOperacion>N1</CalificacionOperacion>
    <BaseImponibleOimporteNoSujeto>4.80</BaseImponibleOimporteNoSujeto>
  </DetalleDesglose>
</Desglose>
<CuotaTotal>10.00</CuotaTotal>
<ImporteTotal>114.80</ImporteTotal>
```

---

## 3 · Consecuencias

### Positivas

- `ImporteTotal` siempre cuadra con el total cobrado al huésped — no
  hay "fugas" entre folio y factura.
- El contable del hotel ve el city tax desglosado en la factura, no
  confundido como IVA exento.
- Compatible con el track legal autonómico (la liquidación
  municipal/autonómica usa el mismo importe).

### Negativas / coste asumido

- **Riesgo de validación AEAT preprod:** la guía no documenta este uso
  de `N1`. Si AEAT lo rechaza, fallback documentado: emitir el city
  tax como cargo `S1` con tipo `0%` (opción B).
- Si la regulación autonómica cambia y el city tax pasa a ser IVA
  reducido (hipotético), hay que migrar — no destructivo, sólo cambio
  de categoría en el folio.

### Neutras

- Las facturas legacy (pre-RFC-001) no llevan city tax y este cambio no
  las afecta. El `invoice-xml.ts` omite el bloque NoSujeta cuando
  `cityTaxAmount` es 0 o ausente.

---

## 4 · Alternativas descartadas

- **B — City tax como S1 al 0%**. Descartada por falsear la
  naturaleza fiscal del impuesto. Sólo se usará como fallback si AEAT
  rechaza N1 en preprod.
- **C — City tax fuera del XML AEAT**. Descartada porque rompe la
  invariante "ImporteTotal = lo cobrado al huésped" y obliga al
  contable a reconciliar manualmente.

---

## 5 · Cómo se cumple en el repo

- Lógica: `apps/api/src/verifactu/invoice-xml.ts:buildVerifactuRegistroAlta`
  emite el bloque NoSujeta cuando `cityTaxAmount > 0`.
- Recomposición: `apps/api/src/verifactu/submit.worker.ts:recomposeBreakdown`
  separa `cityTaxAmount` de `invoice.lines` (JSONB) en el momento de
  firmar.
- Tests: `apps/api/src/verifactu/invoice-xml.spec.ts` cubre los casos
  con y sin city tax. `invoice-totals.spec.ts` verifica que CITY_TAX
  no contamina ni `subtotal` ni `taxAmount`.

---

## 6 · Cuándo revisar

Condiciones que dispararían un ADR superseding:

- AEAT publica guía explícita sobre cómo encajar impuestos autonómicos
  → adaptar al formato oficial.
- AEAT rechaza N1 en preprod por motivo distinto al esperado → pasar
  a fallback B y abrir ADR-034 documentando el cambio.
- Una autonomía nueva entra en city tax con estructura distinta
  (p.ej. % sobre tarifa en lugar de fijo por pax-noche) → puede
  requerir nueva categoría en lugar de NoSujeta plana.

---

_PO: Outman El Ouary Achi · 2026-06-02 (firma delegada en sesión)_
