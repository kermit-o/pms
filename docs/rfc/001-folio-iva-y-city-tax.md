# RFC-001 — Diseño técnico: IVA por línea + City tax en folio

- **Status:** `Approved` (2026-06-01, firma delegada por PO en sesión)
- **Author:** Claude Code
- **Date:** 2026-06-01
- **PRD:** [PRD-001](../prd/001-folio-iva-y-city-tax.md)
- **Related:** ADR-030 (Verifactu), ADR-032 §4 (XML payload),
  `apps/api/src/folio/`, `apps/api/src/verifactu/`
- **Sprint objetivo:** S15

---

## 1 · Resumen ejecutivo

Añadimos tres campos a `FolioEntry` (`netAmount`, `taxRate`, `taxAmount`)
y una `taxCategory` enum. Introducimos una tabla nueva
`PropertyTaxConfig` con la matriz IVA/categoría por property y una
`CityTaxRule` con la regla por property (autonomía, importe, cap,
exenciones). El cálculo vive en un `TaxCalculator` puro que el
`FolioService` y el `NightAuditService` consumen. La UI del folio gana
un toggle "bruto/neto" y una vista de desglose. Verifactu lee el
desglose ya almacenado.

Migración en dos pasos seguros bajo escritura concurrente: expand
(añadir columnas nullable + backfill por código en cargo nuevo) → no se
hace contract en V1 (legacy queda sin desglose, marcado en UI).

---

## 2 · Contexto técnico

Estado hoy:

- `FolioEntry` ([`packages/db/prisma/schema.prisma:644`](../../packages/db/prisma/schema.prisma)):
  `amount Decimal(12,2)`, sin desglose IVA. `attributes Json?` libre.
- `FolioService.addCharge` ([`apps/api/src/folio/folio.service.ts:80`](../../apps/api/src/folio/folio.service.ts)):
  acepta `{description, amount, type}` y persiste tal cual.
- `InvoiceService` (Verifactu, [`apps/api/src/verifactu/invoice.service.ts`](../../apps/api/src/verifactu/invoice.service.ts)):
  llama a `invoice-xml.ts` que **hardcodea 10% IVA**
  ([`invoice-xml.ts:116`](../../apps/api/src/verifactu/invoice-xml.ts)).
  Crítico: en cuanto se active preprod AEAT rechaza facturas con
  estructuras de bar/extras (21%) o exentos (0%).
- `Property` ([`schema.prisma:117`](../../packages/db/prisma/schema.prisma)):
  hoy no tiene config fiscal. `attributes Json?` se usa para channel
  manager + IBE.

Reservation / business-day quedan intactos. RoomType tampoco cambia.

---

## 3 · Diseño propuesto

### 3.1 · Modelo de datos

**Modificaciones a `FolioEntry`** (todas nullable para migración safe):

```prisma
model FolioEntry {
  // ... existente ...
  netAmount    Decimal?     @map("net_amount") @db.Decimal(12, 2)
  taxRate      Decimal?     @map("tax_rate")   @db.Decimal(5, 2)   // 0, 4, 10, 21
  taxAmount    Decimal?     @map("tax_amount") @db.Decimal(12, 2)
  taxCategory  TaxCategory? @map("tax_category")
  // amount sigue siendo el bruto y la fuente de verdad para `balance`.
}

enum TaxCategory {
  ROOM
  BREAKFAST
  EXTRA_FOOD
  EXTRA_OTHER
  CITY_TAX
  EXEMPT

  @@map("tax_category")
}
```

Invariantes (validados en service, no en BD):

- Si `netAmount` o `taxRate` o `taxAmount` están presentes, los tres lo
  están y `amount ≈ netAmount + taxAmount` (tolerancia 0.01€ por
  redondeo).
- `taxCategory` siempre presente en cargos nuevos. NULL solo en
  entradas legacy.

**Tabla nueva `PropertyTaxConfig`**:

```prisma
model PropertyTaxConfig {
  id          String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String      @map("tenant_id") @db.Uuid
  propertyId  String      @map("property_id") @db.Uuid
  category    TaxCategory
  taxRate     Decimal     @map("tax_rate") @db.Decimal(5, 2)
  effectiveFrom DateTime  @default(now()) @map("effective_from") @db.Date
  createdAt   DateTime    @default(now()) @map("created_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@unique([propertyId, category, effectiveFrom])
  @@index([tenantId, propertyId])
  @@map("property_tax_configs")
}
```

Default seed por property (idempotente en seed-piloto y en
`Property.onCreate`):

| Category | taxRate |
|---|---|
| ROOM | 10.00 |
| BREAKFAST | 10.00 |
| EXTRA_FOOD | 10.00 |
| EXTRA_OTHER | 21.00 |
| CITY_TAX | 0.00 |
| EXEMPT | 0.00 |

**Tabla nueva `CityTaxRule`**:

```prisma
model CityTaxRule {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  propertyId      String   @unique @map("property_id") @db.Uuid
  region          CityTaxRegion @default(NONE)
  amountPerNight  Decimal  @default(0) @map("amount_per_night") @db.Decimal(8, 2)
  appliesToAdults Boolean  @default(true) @map("applies_to_adults")
  appliesToChildren Boolean @default(false) @map("applies_to_children")
  childAgeThreshold Int    @default(16) @map("child_age_threshold")
  maxNights       Int      @default(7) @map("max_nights")
  effectiveFrom   DateTime @default(now()) @map("effective_from") @db.Date
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@index([tenantId, propertyId])
  @@map("city_tax_rules")
}

enum CityTaxRegion {
  NONE
  CATALUNYA
  BALEARES
  COMUNIDAD_VALENCIANA

  @@map("city_tax_region")
}
```

Por ahora `region` se usa como label informativa. La lógica vive en
`amountPerNight + appliesTo* + maxNights`. V2 podrá codificar la
tabla legal por región (varía con estrellas / temporada).

**RLS**: ambas tablas nuevas llevan política RLS por `tenant_id` igual
que el resto.

**Migración**:

```
20260602_000000_folio_tax_breakdown/
  migration.sql
```

Contenido:

1. `ALTER TABLE folio_entries ADD COLUMN net_amount NUMERIC(12,2)`, etc.
2. `CREATE TYPE tax_category`.
3. `CREATE TABLE property_tax_configs ...` con RLS policy.
4. `CREATE TABLE city_tax_rules ...` con RLS policy.
5. `CREATE INDEX` necesarios.
6. **NO** modificamos rows existentes. Quedan con `tax_*` NULL → marcadas
   "legacy" en UI.

Backfill por código en `Property.onCreate` hook + script
`scripts/backfill-property-tax-config.ts` para tenants existentes
(ejecutado manualmente en deploy de la feature).

### 3.2 · API / endpoints

**Endpoints modificados:**

`POST /folios/:folioId/charges` (DTO extendido):

```ts
const AddChargeDto = z.object({
  description: z.string().min(1).max(200),
  type: z.enum(['CHARGE', 'TAX', 'ADJUSTMENT']),
  // Modo 1: dar bruto y categoría (el server desglosa).
  amount: z.number().positive().optional(),
  // Modo 2: dar neto y rate (el server calcula bruto).
  netAmount: z.number().positive().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  // Obligatorio en cargos nuevos. NULL solo en legacy.
  taxCategory: z.nativeEnum(TaxCategory),
  idempotencyKey: z.string().min(1).max(100).optional(),
}).refine(
  (d) => (d.amount !== undefined) !== (d.netAmount !== undefined),
  'O dar amount O dar netAmount, no ambos',
);
```

**Endpoints nuevos:**

- `GET /properties/:propertyId/tax-config` — devuelve la matriz actual.
- `PUT /properties/:propertyId/tax-config/:category` — `{taxRate}`,
  crea un nuevo `effectiveFrom = today` (histórico, no destructivo).
- `GET /properties/:propertyId/city-tax-rule` — devuelve la regla.
- `PUT /properties/:propertyId/city-tax-rule` — actualiza la regla.
  Auditado en log + evento `property.city_tax_rule_updated`.
- `POST /folios/:folioId/city-tax-override` — `{newAmount, reason}`.
  `reason.length >= 10`. Emite `folio.city_tax_overridden`. Crea una
  `FolioEntry` tipo `ADJUSTMENT` con `taxCategory=CITY_TAX` y
  `attributes={originalAmount, reason}`.
- `GET /folios/:folioId/tax-breakdown` — agrega entries del folio en:
  ```ts
  {
    subtotal: string,       // suma de netAmount
    taxByRate: [{ rate: '10', taxAmount: '...', net: '...' }, ...],
    cityTax: string,        // suma de entries taxCategory=CITY_TAX
    total: string,          // suma de amount
  }
  ```
- `GET /folios/tax-report?propertyId=&from=&to=` — agregado por día.
  Rol `accountant` o `manager`.

**Eventos NATS nuevos** (catalog: `packages/eventbus`):

- `folio.entry_with_tax_added` — payload tal como en PRD-001 §7.
- `folio.city_tax_applied` — durante night audit.
- `folio.city_tax_overridden` — desde el endpoint nuevo.
- `property.city_tax_rule_updated` — auditoría.

### 3.3 · Lógica de servicio

**Servicio nuevo: `TaxCalculator`** (`apps/api/src/folio/tax-calculator.ts`)

Puro, sin Prisma. Recibe inputs validados y devuelve desglose. Tres
funciones públicas:

```ts
breakdownFromGross(input: { gross: Decimal, taxRate: Decimal }): {
  net: Decimal,
  tax: Decimal,
  gross: Decimal,
}

breakdownFromNet(input: { net: Decimal, taxRate: Decimal }): {
  net: Decimal,
  tax: Decimal,
  gross: Decimal,
}

computeCityTax(input: {
  rule: CityTaxRule,
  adults: number,
  children: { age: number }[],
  nights: number,
}): {
  perNight: Decimal,
  totalNights: number,    // capped a maxNights
  total: Decimal,
}
```

Reglas de redondeo: half-up a 2 decimales. Todo en `Prisma.Decimal`.
Tests con casos: 90€ + 10% = 81.82 / 8.18 / 90.00; 100€ + 21% = 82.64 /
17.36 / 100.00.

**`FolioService.addCharge` cambia así:**

1. Resuelve `taxRate`:
   - Si DTO trae `taxRate`, úsalo.
   - Si no, `taxRate = PropertyTaxConfig.find(propertyId, category)`.
2. Calcula desglose via `TaxCalculator`.
3. Persiste con los 3 campos + `taxCategory`.
4. `folio.balance` se sigue actualizando con `amount` (bruto). Sin
   cambio.

**`NightAuditService.postRoomCharges`** (futuro, hoy lo hace manual el
recepcionista en muchos casos):

- Por cada reserva CHECKED_IN, postea cargo ROOM + city tax si la regla
  aplica.
- City tax como entry separado con `taxCategory=CITY_TAX`, `taxRate=0`,
  `attributes={nights, pax}`. Visible en factura.

**`InvoiceService` (Verifactu)** se actualiza:

- Agrupa entries del folio por `taxRate`.
- `invoice-xml.ts` ya no hardcodea `10.00`; recibe el desglose y genera
  un bloque `<DesgloseFactura>` por cada `taxRate` presente (ADR-032 §4
  permite múltiples bloques).
- Entries `taxCategory=CITY_TAX` van en bloque `<NoSujeta>` (city tax
  no es IVA repercutido sino impuesto de otra naturaleza — verificar
  con asesoría AEAT en preprod; si AEAT lo rechaza, fallback a bloque
  exento dentro de `<Sujeta>`).

### 3.4 · UI

**`apps/web-fo/src/app/folios/[id]/page.tsx`** (vista del folio):

- Tabla de entries gana columnas: `Categoría`, `Base`, `% IVA`, `Cuota`,
  `Total`. Las filas legacy (`taxAmount IS NULL`) muestran "—" en las
  columnas nuevas y un badge gris "legacy".
- Pie del folio gana caja de desglose: subtotal por tipo IVA + total
  city tax + total.

**Formulario "Añadir cargo":**

- Selector de `categoría` (ROOM, BREAKFAST, EXTRA_FOOD, EXTRA_OTHER,
  CITY_TAX, EXEMPT). El %IVA aparece auto-rellenado desde
  `PropertyTaxConfig`, editable en línea.
- Toggle "Importe bruto / Importe neto" — si neto, muestra preview
  del bruto al lado.

**`apps/web-fo/src/app/properties/[id]/tax-config/page.tsx`** (nuevo,
admin):

- Tabla editable de la matriz categoría/%IVA. Botón "guardar" → crea
  histórico con `effectiveFrom` hoy.
- Form de regla de city tax: región, importe por noche, exenciones,
  cap. Confirmación con preview.

**Override de city tax (front desk):**

- Botón "Ajustar city tax" en la fila CITY_TAX del folio.
- Modal con `newAmount` + `reason` (≥ 10 chars, contador).
- Submit → POST endpoint nuevo.

Roles Keycloak:

- `front_desk` puede añadir cargos y hacer override de city tax.
- `manager` adicionalmente puede editar `PropertyTaxConfig` y
  `CityTaxRule`.
- `accountant` puede ver el tax-report.

### 3.5 · Multitenancy

- `PropertyTaxConfig` y `CityTaxRule` llevan `tenant_id` y policy RLS.
- Todas las queries pasan por `PrismaService.withTenant(ctx, ...)`.
- Eventos llevan `tenantId`.
- Métricas con label `tenant` (ya bajo cardinalidad acotada — V1 ≤ 200
  tenants).

### 3.6 · Compliance

- **Verifactu (ADR-030, ADR-032):** este RFC habilita el envío real.
  No hay PCI (PAN nunca toca esto).
- **GDPR:** ningún dato PII nuevo. Categorías y rates no son PII.
- **Audit trail:** todo cambio en `PropertyTaxConfig` o `CityTaxRule` se
  guarda con histórico (no se sobrescribe; `effectiveFrom`/`createdAt`).
- **City tax como concepto fiscal autonómico:** consultar con asesoría
  si AEAT exige formato específico en el XML. Mientras no se confirme,
  V1 lo envía como `NoSujeta` y el reporting separado permite la
  liquidación manual al ayuntamiento.

---

## 4 · Tests

**Unit (vitest)**:

- `tax-calculator.spec.ts` (nuevo):
  - breakdownFromGross con 10%, 21%, 4%, 0%.
  - breakdownFromNet recíproco.
  - Redondeo half-up casos limítrofes (X.005).
  - computeCityTax con cap, sin cap, con/sin niños, edge case 0 noches.
- `folio.service.spec.ts` (extender):
  - `addCharge` modo gross — verifica desglose persistido.
  - `addCharge` modo net — verifica gross calculado.
  - `addCharge` con `taxRate` override — usa el del DTO, no el de config.
  - `addCharge` sin `taxCategory` → 400.
  - Backward-compat: legacy entries readable.
- `night-audit.service.spec.ts` (extender):
  - postRoomCharges aplica city tax según regla, capped.
  - postRoomCharges con regla NONE → no aplica city tax.

**Integration**:

- `folio.controller.e2e-spec.ts`: POST cargo + GET tax-breakdown
  agregado correcto.
- `tax-report.e2e-spec.ts`: range query agregado por día.

**Verifactu**:

- `invoice-xml.spec.ts`: XML con dos bloques (10% y 21%) válido contra
  schema. City tax en `NoSujeta`.
- `invoice.service.spec.ts`: golden file actualizado.

**E2E Playwright** (opcional V1):

- `folio-tax-flow.spec.ts`: añadir cargo → ver desglose → cerrar folio
  → factura Verifactu con desglose correcto.

**No se testea explícitamente:**

- Performance del cálculo (es aritmética sobre Decimal, despreciable).
- Migración de prod (se valida con script en staging).

---

## 5 · Observabilidad

**Logs estructurados**:

```
{ event: 'folio.entry_with_tax_added', tenantId, folioId, entryId,
  taxRate, taxAmount, category, actorId, correlationId }
```

**Métricas Prometheus (vía OTel)**:

- `pms_folio_tax_breakdown_total_eur{tenant,property,tax_rate}` —
  counter, EUR cobrado por rate.
- `pms_folio_city_tax_collected_eur{tenant,property}` — counter.
- `pms_folio_city_tax_override_count{tenant,property,reason_bucket}` —
  counter. `reason_bucket` = primeras 20 chars del motivo (cardinalidad
  acotada hasheando si fuera necesario).

**Trazas**: span nuevo `folio.tax_calculation` dentro de `addCharge`.

**Alertas** (`infra/grafana`):

- "City tax overrides > 10% de cargos CITY_TAX en 24h por property" →
  warning, posible mala config.
- "Folio entries con taxAmount NULL creados después de la fecha del
  deploy" → critical, regresión.

---

## 6 · Rollout

**Feature flag**: `FOLIO_TAX_BREAKDOWN_ENABLED` por tenant (env var +
columna opcional en Tenant para granularidad). Default `false` en
tenants existentes, `true` en tenants nuevos (creados después del
deploy) y en el piloto.

**Orden de despliegue**:

1. Migración Prisma (forward-only, columnas nullable + tablas nuevas).
2. Backfill por código en `Property.onCreate` + script manual para
   tenants existentes.
3. Deploy API con flag `false` para tenants existentes.
4. Deploy web-fo con UI nueva (rinde "legacy" en entries antiguas).
5. Activar flag en piloto.
6. Smoke test en piloto: añadir cargo, verificar desglose, cerrar
   folio, verificar XML Verifactu en `preprod` (no production aún).
7. Activar resto de tenants progresivamente.

**Rollback**:

- Desactivar flag → `addCharge` vuelve a comportamiento legacy
  (acepta `amount` sin `taxCategory`).
- Las nuevas columnas quedan; no son destructivas.

---

## 7 · Riesgos técnicos

| Riesgo | Prob | Impacto | Mitigación |
|---|---|---|---|
| Redondeo divergente entre breakdownFromGross y breakdownFromNet en valores limítrofes. | M | M | Half-up explícito, tests con X.005, X.995. |
| Backfill de `PropertyTaxConfig` falla para un tenant sin properties. | B | B | Script idempotente; skip tenants sin properties; log warning. |
| AEAT rechaza city tax en `<NoSujeta>` en preprod. | M | M | Probar en preprod antes de production. Fallback documentado: emitir city tax como cargo `EXEMPT` dentro de `<Sujeta>` con rate 0. |
| UI confunde "bruto/neto" → el recepcionista mete neto pensando que es bruto. | M | A | Preview en vivo del importe complementario al lado del input. Tooltip explicativo. |
| Override de city tax usado para esconder errores → contabilidad descuadrada. | M | M | Alert > 10% overrides + reporte mensual de overrides al manager. |
| Cálculo de city tax en estancias que cruzan medianoche del business day. | B | B | Usar `nights` calculado por business-day del NA, no por reloj UTC. |

---

## 8 · Alternativas consideradas

### 8.1 · Tabla `Tax` separada por línea (1:N entry → taxes)

Descartada: añade join en cada lectura de folio sin beneficio en V1
(siempre hay exactamente 1 IVA por línea). Si V2 trae recargo de
equivalencia o impuestos sumados (ITP), se promueve.

### 8.2 · `taxRate` global en property, no por categoría

Descartada: España tiene categorías con tipos distintos (10% room vs.
21% bar/wellness/parking). Sin matriz por categoría, el recepcionista
edita el % en cada cargo.

### 8.3 · Calcular el desglose al emitir factura, no en el cargo

Descartada: viola inmutabilidad. Si el PO cambia la matriz entre cargo
y factura, la factura no representa lo cobrado.

### 8.4 · City tax como producto add-on en el rate plan (acoplado a la
   reserva, no al folio)

Descartada para V1: el city tax depende del huésped real (pax check-in
puede diferir del de la reserva). Más limpio aplicarlo en el folio.

---

## 9 · Decisiones que necesitan ADR

Una sola:

- **ADR-033 — City tax como `<NoSujeta>` en Verifactu**. Decisión
  arquitectónica perdurable porque condiciona cómo modelamos otros
  impuestos no-IVA en el futuro (ITP, recargo de equivalencia). Se
  abre junto al primer PR de implementación.

El resto son decisiones de feature, cubiertas por este RFC.

---

## 10 · Dependencias externas

- **Librerías npm**: ninguna nueva. Usamos `Prisma.Decimal` que ya
  está. (Cumple CLAUDE.md §8.)
- **SaaS**: ninguno nuevo.
- **Datos del PO**:
  - Confirmación legal de tipos IVA 2026 (ya delegado, default
    propuesto aceptado).
  - Confirmación con asesoría AEAT sobre city tax en XML (a obtener
    durante la fase de preprod, no bloquea V1 con tenants sin city tax).

---

## 11 · Plan de trabajo (PRs)

1. **PR #1 — Migración + modelos Prisma**
   - `packages/db/prisma/schema.prisma` + migration.sql
   - Backfill seed `scripts/seed-piloto.ts`
   - Script `scripts/backfill-property-tax-config.ts`
   - Tests: schema regenerate + migration up/down idempotente
2. **PR #2 — TaxCalculator puro**
   - `apps/api/src/folio/tax-calculator.ts`
   - `tax-calculator.spec.ts` (~25 tests)
3. **PR #3 — FolioService.addCharge + endpoints PropertyTaxConfig**
   - Extender DTO, service, controller
   - Endpoints admin CRUD config
   - Tests service + e2e
4. **PR #4 — CityTaxRule + override endpoint + NA hook**
   - Service, controller, override endpoint
   - Auto-apply en night audit
   - Tests
5. **PR #5 — UI folio: columnas desglose + form bruto/neto**
   - `apps/web-fo/src/app/folios/[id]/page.tsx`
   - Form "Añadir cargo"
6. **PR #6 — UI admin: tax-config + city-tax-rule**
   - Página admin nueva
   - Roles + guards
7. **PR #7 — Verifactu: invoice-xml usa desglose real**
   - `invoice-xml.ts` parametrizado
   - Golden file actualizado
   - **ADR-033** sobre city tax en XML
8. **PR #8 — Tax report endpoint + UI manager**
   - GET /folios/tax-report
   - Página de reporte simple
9. **PR #9 — RUNBOOK + DELIVERY-LOG + activación feature flag piloto**

Cada PR cita "RFC-001 §N.M" en el commit principal.

---

## 12 · Firma

- **Tech reviewer:** Claude Code · 2026-06-01
- **PO:** _Outman El Ouary Achi · 2026-06-01 (firma delegada en sesión)_

RFC aprobado. Empieza implementación por PR #1 (migración + modelos).
