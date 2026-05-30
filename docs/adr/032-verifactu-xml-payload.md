# ADR-032 — Payload XML Verifactu (registro de facturación)

- **Status:** Proposed (PO decide).
- **Date:** 2026-05-30
- **Sprint:** S14 W2 (`claude/s14-w2-verifactu`)
- **Driver:** El generador actual `buildInvoiceXml()` produce un XML
  con root `<AubergineVerifactuInvoiceStub>` — etiqueta inventada. AEAT
  lo rechazará por estructura antes de mirar la firma. Necesitamos el
  payload conforme al schema oficial.
- **Related:** ADR-030 (arquitectura), ADR-031 (librería XAdES — bloquea
  el envoltorio de firma pero no el contenido).

---

## 1. Contexto

El SubmitWorker está cerrado en bucle con el `StubAeatClient` desde el
commit anterior. Lo único que el cliente stub mira es "es XML bien
formado". El cliente real (preprod o producción) validará:

1. **Estructura conforme al XSD AEAT** publicado en sede electrónica.
2. **Firma XAdES-BES** sobre el registro (ADR-031).
3. **Encadenamiento de huellas**: cada registro lleva un campo `Huella`
   = SHA-256 del registro anterior + campos identificativos del actual.
   Si la cadena se rompe → rechazo.
4. **Identificador del SistemaInformatico** (nuestro PMS) registrado
   previamente con AEAT.

Hoy no cumplimos ninguna de las cuatro. Esta ADR cierra el punto 1 +
identifica las decisiones operativas asociadas al punto 3 + 4.

### Fuentes regulatorias

- **RD 1007/2023** de 5 de diciembre — marco legal Verifactu.
- **Orden HAC/1177/2024** de 17 de octubre — especificaciones técnicas
  (define la estructura mínima del registro).
- **XSDs y guía técnica** publicados por AEAT en
  `sede.agenciatributaria.gob.es` apartado "Información y trámites de
  ayuda · Sistemas Informáticos de Facturación y Verifactu". **Los
  nombres exactos de elementos y atributos en este ADR están marcados
  explícitamente: ✅ confirmado por texto regulatorio · ⚠ por verificar
  contra el XSD vigente antes de codificar.**

---

## 2. Estructura del registro de alta (RegistroAlta)

Lo siguiente refleja lo que el texto regulatorio fija. Los nombres
exactos del XSD pueden diferir ligeramente — verificar antes de
implementar.

```
RegFactuSistemaFacturacion                            ⚠ root, por verificar
└── RegistroAlta                                      ⚠ por verificar
    ├── IDVersion                                     ✅ versión spec (e.g. "1.0")
    ├── IDFactura                                     ✅ identidad compuesta
    │   ├── IDEmisorFactura
    │   │   ├── NIF                                   ✅ NIF emisor (hotel)
    │   │   └── NombreRazon                           ✅ razón social
    │   ├── NumSerieFactura                           ✅ serie + número
    │   └── FechaExpedicionFactura                    ✅ DD-MM-YYYY
    ├── TipoFactura                                   ✅ enum (ver §3)
    ├── DescripcionOperacion                          ✅ texto libre
    ├── Destinatarios                                 ✅ array
    │   └── IDDestinatario
    │       ├── NombreRazon
    │       ├── NIF       (o)
    │       └── IDOtro    (extranjeros: tipo + país + id)
    ├── Desglose                                      ✅ líneas con IVA
    │   └── DetalleDesglose[]
    │       ├── ClaveRegimen                          ⚠ codigos AEAT
    │       ├── CalificacionOperacion
    │       ├── TipoImpositivo                        ✅ % IVA
    │       ├── BaseImponibleOimporteNoSujeto
    │       └── CuotaRepercutida
    ├── CuotaTotal                                    ✅ suma IVA
    ├── ImporteTotal                                  ✅ total factura
    ├── Encadenamiento                                ✅ ver §4
    │   ├── PrimerRegistro                            (o)
    │   └── RegistroAnterior
    │       ├── IDEmisorFactura
    │       ├── NumSerieFactura
    │       ├── FechaExpedicionFactura
    │       └── Huella
    ├── SistemaInformatico                            ✅ identifica el PMS, ver §5
    │   ├── NombreRazon
    │   ├── NIF
    │   ├── NombreSistemaInformatico
    │   ├── IdSistemaInformatico
    │   ├── Version
    │   └── NumeroInstalacion
    ├── FechaHoraHusoGenRegistro                      ✅ ISO 8601 con TZ
    ├── TipoHuella                                    ✅ "01" = SHA-256
    ├── Huella                                        ✅ ver §4
    └── (Signature XAdES-BES — añadido por el signer ADR-031)
```

---

## 3. Tipos de factura

Códigos relevantes para nuestro caso boutique-hotel (Verifactu permite
más, no los usamos en MVP):

| Código | Descripción                          | Cuándo se emite |
| ------ | ------------------------------------ | --------------- |
| F1     | Factura completa                     | Default. Cliente identificado. |
| F2     | Factura simplificada                 | Total ≤ 400 € sin desglose IVA exigible, o ≤ 3.000 € en hostelería. |
| R1-R5  | Rectificativas (varios subtipos)     | Cuando se anula/modifica una emitida. **No MVP** — fuera de scope hasta W3+. |

**Decisión MVP propuesta:** Por defecto F1 si el cliente tiene NIF;
F2 si la factura es ≤ 3.000 € **y** el cliente no proporcionó NIF
(walk-in pagando efectivo, p.ej.). Rectificativas se bloquean en
backend con `BadRequest` "Sprint 14 no soporta rectificativas".

**Pregunta al PO:** ¿OK con esta heurística F1/F2 para MVP?

---

## 4. Encadenamiento de huellas

Mecanismo "blockchain ligero" del art. 8 RD 1007/2023:

1. Cada registro lleva `Huella = SHA256(huella_registro_anterior +
   campos_identificativos_del_actual_serializados)`.
2. El primer registro de la cadena por emisor lleva `<PrimerRegistro>`
   en lugar de `<RegistroAnterior>`.
3. AEAT rechaza un registro cuyo `Huella` no se valide contra el
   estado del lado servidor — esto detecta saltos o reescrituras
   silenciosas.

**Implicación en nuestro modelo de datos:**

El schema actual `Invoice` **no guarda la huella**. Hay que añadir:

```prisma
model Invoice {
  ...
  huella           String?  @map("huella") @db.Char(64)        // hex SHA-256
  huellaAnterior   String?  @map("huella_anterior") @db.Char(64) // null = primer registro del emisor
  ...
}
```

Y un índice/lock para asegurar que el cálculo de huella es secuencial
por emisor (`tenantId, propertyId, series` — depende del §5).

**Cálculo de la huella propuesto** (a verificar contra spec técnica):

```
huella = sha256(
  prev_huella_o_vacío    ||
  IDEmisorFactura.NIF    ||
  NumSerieFactura        ||
  FechaExpedicionFactura ||
  TipoFactura            ||
  CuotaTotal             ||
  ImporteTotal
)
```

**Concurrencia:** la generación de huella exige serialización por
"cadena". Sugerencia: lock por `(tenantId, propertyId)` en una tabla
`invoice_chain_lock` o `SELECT ... FOR UPDATE` sobre el último Invoice
de ese emisor durante la transacción de `InvoiceService.issue()`.

**Pregunta al PO:** ¿La cadena de huellas es por **tenant** (un emisor
global) o por **propertyId** (cada hotel = un IDEmisor)? Ver §5.

---

## 5. ¿Quién es IDEmisorFactura?

Tres modelos posibles según multi-tenant + multi-property:

### 5.a Un IDEmisor por tenant

- NIF = NIF de la empresa hotelera. NombreRazon = razón social.
- Si el tenant tiene varias propiedades, todas comparten emisor.
- Cadena de huellas única por tenant.

### 5.b Un IDEmisor por property

- NIF de la sociedad operadora del hotel concreto (grupos hoteleros
  suelen tener una SL por establecimiento).
- Cadena de huellas independiente por property.

### 5.c Mixta — configurable por tenant

- El tenant declara en setup si centraliza facturación o factura por
  property.

**Implicación operativa:** afecta a la UI de configuración (admin/billing)
y a la base de datos: el NIF / razón social emisor debe vivir en `Tenant`
(modelo 5.a) o `Property` (modelo 5.b) — hoy **no vive en ninguno**.

**Schema gap actual:** ni `Tenant` ni `Property` tienen `nif` /
`razonSocial`. Hay que añadirlos en una de las dos tablas (depende del
modelo elegido) + migración con valor default temporal o `NOT NULL` +
onboarding obligatorio.

**Pregunta al PO:** ¿Modelo 5.a (un emisor por tenant — simple) o 5.b
(un emisor por property — preciso pero más config)?

**Mi recomendación:** 5.a en MVP, escalable a 5.b en V2. La mayoría de
hoteles boutique en Spain operan con una sola sociedad. Si aparece un
piloto multi-property con sociedades distintas, migramos a 5.c.

---

## 6. SistemaInformatico

AEAT requiere identificar el software emisor con cinco campos. Tres son
constantes en build, dos requieren registro previo con AEAT.

| Campo                       | Valor propuesto                       | Comentario |
| --------------------------- | ------------------------------------- | ---------- |
| NombreRazon                 | "Aubergine PMS, S.L." (nuestra SL)    | Razón social del fabricante. |
| NIF                         | NIF de Aubergine PMS, S.L.            | El PO lo provee. |
| NombreSistemaInformatico    | "Aubergine PMS"                       | Constante en build. |
| IdSistemaInformatico        | Asignado por AEAT al registrar el PMS | **Trámite operativo PO**. |
| Version                     | `pkg.version` (e.g. "1.0.0")          | Constante por release. |
| NumeroInstalacion           | UUID por instancia / tenant           | Idea: `tenantId` (UUID v4). |

**Pregunta al PO:**
1. NIF de la sociedad Aubergine PMS, S.L. (para incrustarlo en build).
2. Estado del registro como SistemaInformatico ante AEAT — **bloqueante
   para envío real**, no para preprod (preprod usa un id de prueba).
3. ¿OK usar `tenantId` como `NumeroInstalacion`? (alternativa: UUID
   estable por hotel generado al onboard).

---

## 7. Schema gaps a cerrar

Para implementar el generador real, hace falta:

1. **`Tenant.nif` + `Tenant.razonSocial`** (o `Property.*` si modelo 5.b)
   — emisor. Migración nueva.
2. **`Invoice.huella` + `Invoice.huellaAnterior`** — encadenamiento.
   Migración nueva.
3. **Mecanismo de lock secuencial por cadena**:
   - Opción A: `SELECT ... FOR UPDATE` sobre el último Invoice del emisor
     durante la transacción de issue (ya estamos en transacción Prisma).
   - Opción B: tabla auxiliar `InvoiceChainLock(emisorKey)` con
     `SELECT FOR UPDATE` allí.
4. **Líneas de factura con desglose IVA** (`DetalleDesglose[]`):
   - Hoy `Invoice.lines: Json` guarda un snapshot del folio, pero no en
     formato AEAT. El generador debe leer ese snapshot, agrupar por tipo
     de IVA, y emitir `DetalleDesglose` por grupo.
   - Necesario: política de qué tipo de IVA aplica a cada tipo de cargo
     (alojamiento 10%, restauración 10%/21%, parking 21%, etc.). **Hoy
     no la tenemos** — los cargos del folio no llevan tipo de IVA.
   - Esto puede ser un Sprint propio.

**Pregunta al PO:** ¿Cubrimos el IVA por línea como parte del W2 o lo
sacamos a un mini-sprint dedicado? Si lo dejamos para después, el
MVP enviaría **todas las facturas con un único tipo (10% alojamiento)**
como simplificación — viable para piloto boutique con servicios
mínimos, no para hoteles con restaurante.

---

## 8. Plan de implementación

**Si el PO aprueba los puntos 3, 5, 6, 7 anteriores:**

1. **Migración schema** (`Tenant.nif/razonSocial`, `Invoice.huella/anterior`).
2. **Helper `computeHuella()`** + tests con vectores conocidos (el PO
   puede facilitar 2-3 facturas + huellas validadas por AEAT para
   anclar el test).
3. **`buildVerifactuRegistroAlta()`** que reemplaza `buildInvoiceXml()`.
   Genera el XML conforme al XSD oficial. Marcado con `// VERIFICADO
   CONTRA XSD vYYYY-MM-DD` al final del review contra el XSD vigente.
4. **Tests del generador**: snapshot de XML esperado para 3-4 facturas
   tipo (F1 con NIF, F1 sin NIF, F2 simplificada). Comparación contra
   un golden file revisado a mano.
5. **`InvoiceService.issue()`** acepta el lock secuencial + actualiza
   huella del invoice.
6. **Migración de datos**: las facturas pre-Verifactu mantienen
   `huella=null` y no se vuelven a publicar a AEAT.

Estimado: 1.5-2 días (sin la dependencia XAdES; con XAdES en paralelo
suma ~0.5d más).

---

## 9. Decisiones pendientes (resumen para el PO)

| # | Decisión                                                                  |
| - | ------------------------------------------------------------------------- |
| A | Heurística F1/F2 propuesta en §3, ¿OK?                                    |
| B | Modelo IDEmisor: §5.a (un emisor por tenant) o §5.b (por property)?       |
| C | NIF de la sociedad Aubergine PMS, S.L. (SistemaInformatico).              |
| D | Estado del registro PMS ante AEAT (preprod IdSistemaInformatico ya?).     |
| E | `NumeroInstalacion = tenantId`, ¿OK?                                      |
| F | IVA por línea: ¿incluir en W2 o sprint dedicado? Si no, ¿asumimos 10%?    |
| G | XSD oficial vigente: ¿puedes confirmar URL / versión que debo seguir?     |

---

## 10. Consecuencias

Si se acepta:

- **Sprint 14 W2** crece en ~2 días (lock, huellas, generador real, IVA
  por línea si va en W2).
- **Schema Prisma** gana `nif/razonSocial` en `Tenant` (o `Property`) y
  `huella/huellaAnterior` en `Invoice`. Onboarding obligatorio para
  rellenar el NIF emisor antes de poder emitir facturas Verifactu.
- **DELIVERY-LOG** documentará la sustitución del `buildInvoiceXml()`
  stub por el generador real.

Si se rechaza:

- El módulo seguirá funcionando en modo stub-end-to-end. **No es
  enviable a AEAT preprod** sin esta ADR.

---

_Maintainer: este ADR se actualiza vía PR. Una vez Accepted, las
decisiones no se cambian — se superseden con nueva ADR._
