# PRD-001 — IVA por línea + City tax en el folio

- **Status:** `Draft` (pendiente firma PO)
- **Author:** Claude Code (borrador) · firma PO Outman El Ouary Achi
- **Date:** 2026-06-01
- **Bloque maestro:** B · Folio (funciones B.6 + B.7)
- **Related:** PRD-000 §3 (bloque B), ADR-030 (Verifactu), PROCESS.md
- **Sprint objetivo:** próximo sprint disponible (S15)

---

## 1 · Problema

Hoy el folio agrega todo en un único campo `amount` (Decimal 12,2). El
campo `currency` existe pero no hay desglose de **IVA** ni concepto de
**city tax** (impuesto turístico por noche).

Consecuencias reales en producción:

1. **El contable del hotel rehace el folio en Excel** para separar base
   imponible y cuota de IVA. Cada cierre de folio cuesta 5-15 minutos
   manuales por reserva.
2. **Verifactu real no puede enviarse**: el `RegistroAlta` (ADR-032 §4)
   exige `BaseImponible` + `TipoImpositivo` + `CuotaRepercutida` por
   tipo. Hoy enviamos un total agregado al stub; al activar `preprod`
   AEAT rechaza el XML.
3. **El city tax (impuesto turístico autonómico/municipal: Barcelona,
   Baleares, Cataluña, ...) no se aplica automáticamente.** El
   recepcionista lo añade como cargo manual y se olvida en el 10-20%
   de las estancias. Riesgo: liquidación incorrecta al ayuntamiento +
   pérdida directa para el hotel.

Historia real: en Cataluña una habitación 90€/noche para 2 adultos en
hotel 4★ debe llevar IVA 10% + city tax 1.20€/noche por adulto × 2 ×
nº noches (capped a 7 noches). Hoy el front desk lo calcula a mano si
se acuerda.

---

## 2 · Para quién

- **Primario:** boutique 30-150 habs en España con régimen general
  (todos los hoteles objetivo del PRD maestro).
- **Especialmente crítico:** hoteles en autonomías con city tax activa
  (Cataluña, Baleares, Comunidad Valenciana). Para el resto, el city
  tax queda configurado en 0 y desaparece de la UI.
- **Aplica también a** B&Bs y hosterías rurales (segmentos secundario y
  terciario del PRD maestro).

---

## 3 · Resultado esperado

Al cerrar 30 folios consecutivos en un hotel piloto catalán:

- 30/30 facturas llevan desglose de IVA correcto por línea.
- 30/30 estancias tienen city tax aplicado automáticamente, conforme a
  la normativa autonómica vigente.
- 0 ajustes manuales por el contable.
- Tiempo de cierre de folio por reserva: < 15 segundos (hoy 5-15 min con
  Excel).
- Verifactu en `preprod` acepta el XML del 100% de los `RegistroAlta`
  generados (gate técnico).

---

## 4 · Criterios de aceptación funcionales

1. **Cada línea de folio almacena IVA explícito.** Al crear un cargo,
   el sistema acepta o calcula: `netAmount`, `taxRate`, `taxAmount`,
   y el `amount` total = `netAmount + taxAmount`. Se almacenan los tres.

2. **El tipo de IVA viene de una tabla de categorías por property**:
   - `ROOM` → 10% (España, régimen general 2026).
   - `BREAKFAST` → 10%.
   - `EXTRA_FOOD` → 10%.
   - `EXTRA_OTHER` → 21%.
   - `CITY_TAX` → exento (0%).
   - El PO/admin del hotel puede ajustar los tipos por property si la
     ley cambia o si la categoría aplica otro tipo.

3. **El recepcionista crea un cargo dando importe bruto** ("100€
   habitación"). El sistema desglosa `netAmount = 90.91`,
   `taxRate = 10`, `taxAmount = 9.09` y lo guarda.

4. **El recepcionista puede crear un cargo dando importe neto + tipo**
   ("90€ base + 10% IVA") y el sistema calcula el bruto. Toggle en UI.

5. **La vista del folio muestra el desglose**: subtotal base imponible,
   total IVA por tipo (4%, 10%, 21%), city tax, total.

6. **City tax se auto-aplica en el room charge nocturno** del night
   audit, según la regla configurada por property:
   - Importe por noche × PAX (con exclusión opcional de menores).
   - Máximo de noches (cap por estancia).
   - Categoría hotel (estrellas) si la normativa lo exige.

7. **City tax es editable por el front desk** (override con motivo)
   para casos especiales: grupos exentos, autoridades, prensa.

8. **Facturas existentes (anteriores al cambio)** siguen siendo legibles
   sin desglose, marcadas como "legacy" en la UI.

9. **Verifactu submit-worker** consume el desglose nuevo y emite el XML
   con `BaseImponible`/`TipoImpositivo`/`CuotaRepercutida` correcto.

10. **Reporting**: el manager flash (futuro) y un endpoint nuevo
    `GET /folios/tax-report?from=&to=` devuelven el desglose de IVA y
    city tax recaudados, por property, por día.

---

## 5 · Fuera de alcance

- Multi-folio (huésped/empresa/agencia) — eso es PRD-002.
- Routing rules — depende de multi-folio, va con PRD-002.
- Descuentos por línea con su propio IVA — PRD-003.
- Refunds parciales con devolución de IVA — PRD-004.
- Multi-moneda con tipo de cambio histórico — no MVP (V2).
- Tipos de IVA no españoles (UE, terceros países) — no MVP.
- Liquidación automática al ayuntamiento (presentación electrónica del
  city tax) — V2.
- Cambio de tipo de IVA retroactivo por cambio normativo — V2 (en V1, el
  PO actualiza la tabla y solo aplica a cargos futuros).

---

## 6 · Dependencias y bloqueos

**Bloquea:** PRD-002 (multi-folio), PRD-003 (descuentos), Verifactu
real (H.3, H.4 del PRD maestro).

**Bloqueado por:** ninguno. Esta es la base.

**Requiere del PO:**

- Confirmar tabla de tipos de IVA por categoría (sección 4.2 arriba).
- Confirmar reglas de city tax para Cataluña, Baleares, Valencia (las
  tres más relevantes hoy). Si el primer piloto está fuera de estas
  autonomías, configurar a 0 y aplazar la curva de aprendizaje.
- Decidir si el override del recepcionista exige motivo obligatorio
  (recomendación: sí, free-text de ≥ 10 caracteres).

---

## 7 · Métricas a instrumentar

Eventos NATS nuevos:

- `folio.entry_with_tax_added` — `{tenantId, folioId, entryId,
  taxRate, taxAmount, category}`.
- `folio.city_tax_applied` — `{tenantId, folioId, reservationId,
  nights, pax, totalCityTax}`.
- `folio.city_tax_overridden` — `{tenantId, folioId, originalAmount,
  newAmount, reason, actorId}`.

Métricas Grafana:

- `folio_tax_breakdown_total_eur` por `tenantId`, `propertyId`,
  `taxRate`.
- `folio_city_tax_collected_eur` por `tenantId`, `propertyId`.
- `folio_city_tax_override_count` por `tenantId`, `propertyId`.

Logs estructurados con `tenantId`, `folioId`, `actorId` en cada cálculo.

---

## 8 · Riesgos de producto

| Riesgo | Mitigación |
|---|---|
| Tipo de IVA mal configurado para una categoría → factura errónea. | Tabla default España 2026 + validación en seed; UI admin con confirmación al cambiar. |
| City tax cambia por autonomía a media estancia. | Snapshot del rate al check-in; cargos posteriores usan el rate snapshotted. |
| Migración de folios existentes (con `amount` sin desglose). | Migración no destructiva: nuevos campos nullable; UI marca "legacy" si faltan. |
| Pérdida de precisión decimal en cálculos. | Toda la aritmética en `Prisma.Decimal` (12,2), nunca `number`. Tests con casos extremos. |
| Recepcionista olvida aplicar override y carga city tax a autoridad exenta. | UI sugiere override automático según `cardex.attributes.taxExempt` si está marcado. |

---

## 9 · Alternativas consideradas

### 9.1 · Guardar solo el bruto y calcular IVA al emitir factura

Descartado: pierde trazabilidad. Si el tipo de IVA cambia entre el
cargo y la emisión, la factura sale con otro número. Verifactu exige
inmutabilidad del registro.

### 9.2 · Una tabla `Tax` separada por línea

Descartado para V1: añade una tabla más y un join en cada lectura sin
beneficio. Tres columnas en `FolioEntry` (`netAmount`, `taxRate`,
`taxAmount`) cubren V1. Si el día de mañana hay líneas con múltiples
impuestos (IVA + recargo de equivalencia), se promueve a tabla aparte.

### 9.3 · City tax como cargo manual estándar (no automatizado)

Es lo que hay hoy y es el problema. Descartado.

---

## 10 · Firma

- **PO:** _Outman El Ouary Achi · ____________ (pendiente)_
- **Tech lead (Claude Code):** revisado y consistente con PRD-000

Sin firma del PO, el PRD no pasa a RFC.
