# RUNBOOK · Folio Tax (IVA por línea + City tax)

> Operativa del desglose fiscal del folio (RFC-001). Activación, rotura
> de la migración legacy → con desglose, troubleshooting y plan de
> rollback.
>
> Para el modelo + diseño técnico, ver `docs/rfc/001-folio-iva-y-city-tax.md`.

---

## 1 · Cuándo se activa en un tenant

El feature flag por env var `FOLIO_TAX_BREAKDOWN_ENABLED` controla la
exigencia de `taxCategory` en cargos nuevos.

| Estado | Comportamiento |
|---|---|
| `false` (default) | `POST /folios/:id/charges` acepta cargos sin `taxCategory` (modo legacy). |
| `true` | `taxCategory` obligatorio en cargos nuevos. La UI sólo manda payloads completos. |

**Antes de poner `true` en un tenant:**

1. Verifica que tiene `PropertyTaxConfig` poblada para todas las
   categorías (default seed o backfill).
2. Verifica que tiene `CityTaxRule` (puede estar en `NONE` si su
   autonomía no cobra city tax).
3. Avisa al hotelero por email que el formulario va a cambiar.

---

## 2 · Backfill inicial para tenants existentes

Tras desplegar la feature, los tenants existentes necesitan poblar
sus matrices. Hay dos caminos:

### Opción 1 — Script (recomendado para tenants ya en producción)

```bash
DIRECT_URL="$(flyctl ssh console -a pms-api -C 'env | grep DIRECT_URL' | cut -d= -f2-)" \
  pnpm tsx scripts/backfill-property-tax-config.ts --dry-run
```

Revisa la salida JSON (`propertiesScanned`, `taxConfigsCreated`,
`cityTaxRulesCreated`, `skippedExisting`). Si todo cuadra:

```bash
DIRECT_URL="…" pnpm tsx scripts/backfill-property-tax-config.ts
```

El script es idempotente — repetirlo no duplica filas.

### Opción 2 — UI admin (para tenants pequeños / nuevos)

El admin del hotel va a `Property settings → IVA + City Tax` y rellena:

- Matriz IVA por categoría.
- Regla city tax (puede dejarse en NONE).

---

## 3 · Activar el feature flag en producción

Fly.io:

```bash
flyctl secrets set FOLIO_TAX_BREAKDOWN_ENABLED=true -a pms-api --stage
flyctl deploy --strategy rolling -a pms-api
```

`--stage` aplica el secret en el siguiente deploy. El rolling deploy
evita downtime. Tras deploy:

1. Comprueba en `/health/ready` que la API responde.
2. Crea un cargo de prueba en el folio piloto desde la UI:
   - Categoría ROOM, importe bruto 110€.
   - Verifica en la tabla del folio que aparecen las columnas Base /
     %IVA / Cuota.
3. Comprueba `/reports/fiscal?propertyId=…&from=…&to=…` en el rango
   del piloto.

---

## 4 · Rollback

Reversible sin pérdida de datos: las columnas nuevas son nullable y
los entries existentes siguen siendo leíbles sin desglose.

```bash
flyctl secrets set FOLIO_TAX_BREAKDOWN_ENABLED=false -a pms-api
flyctl deploy --strategy rolling -a pms-api
```

La UI mantiene los entries pasados con su badge "legacy"; los nuevos
cargos vuelven al formato sin desglose. Las facturas Verifactu siguen
siendo válidas (los entries pre-rollback ya tienen su breakdown
persistido).

---

## 5 · Cambiar tipos de IVA tras una reforma fiscal

Si la legislación cambia los tipos (p.ej. IVA reducido pasa de 10% a
7%):

1. Admin del hotel va a `IVA + City Tax → Categoría afectada`.
2. Cambia el % → crea una fila nueva en `property_tax_configs` con
   `effective_from = today`.
3. **No** se modifican los entries ya posteados — el folio guarda el
   `taxRate` snapshotted en cada línea. La factura emitida con el rate
   viejo se queda igual (inmutabilidad).

Para rates retroactivos (excepcional, requiere notificación AEAT),
escalar al PO — no hay flow auto en V1.

---

## 6 · Troubleshooting

### "400: no PropertyTaxConfig found for category X"

La categoría usada en el cargo no tiene rate configurado en esa
property. Solución: el admin la rellena en `/properties/:id/tax-config`.

### Facturas pre-RFC-001 enviadas a Verifactu sin desglose

Esperado. El submit-worker emite el bloque legacy al 10% para esas
facturas (sin breakdown). No es un bug. Las facturas nuevas (con
desglose) emiten múltiples `DetalleDesglose`.

### City tax aparece como `S1` (0%) en lugar de `N1` en XML

Comprueba que en `apps/api/src/verifactu/invoice-xml.ts` el bloque
NoSujeta sigue activo. Si AEAT lo rechazó en preprod, hay fallback
documentado en ADR-033 — escalar al PO antes de cambiarlo.

### Tax-report devuelve totales en 0 cuando hay actividad

Comprueba que los entries del rango llevan `postedAt` correcto (UTC) y
que el `propertyId` es el del tenant correcto. RLS filtra por
`tenant_id`, no por `propertyId` — el filtro de property está en el
WHERE de la query.

### Override del city tax — el balance del folio no cambia

El override se materializa como una entrada `ADJUSTMENT` con delta =
`newAmount - currentTotal`. Si `delta = 0` el endpoint responde sin
crear nada (no es bug; comprueba el motivo).

---

## 7 · Métricas y alertas a vigilar

OTel exporta los siguientes counters (label `tenant` + `property`):

- `pms_folio_tax_breakdown_total_eur{tax_rate}` — útil para reconciliar
  con AEAT en preprod/production.
- `pms_folio_city_tax_collected_eur` — útil para liquidación al
  ayuntamiento.
- `pms_folio_city_tax_override_count` — > 10% del total city tax en
  24h por property = warning probable mala config.

Alerta crítica (Grafana, futura): "FolioEntry created with taxAmount
NULL after `FOLIO_TAX_BREAKDOWN_ENABLED=true` flag set" — indica
regresión de validación.

---

_Última actualización: 2026-06-02 (RFC-001 cerrado)._
