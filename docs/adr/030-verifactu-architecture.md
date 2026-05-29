# ADR-030 — Arquitectura Verifactu (e-invoicing AEAT)

- **Status:** Accepted (2026-05-29, PO Outman El Ouary Achi).
- **Date:** 2026-05-29
- **Sprint:** S14 W2 (`claude/s14-w2-verifactu`)
- **Driver:** RD 1007/2023 obliga a emitir facturas verificables (envío en
  tiempo real a la AEAT) a hoteles del régimen general desde 1-jul-2026.
- **Related:** ADR-023 (Fly region cdg), CLAUDE.md §11 (compliance).

---

## 1. Contexto

Aubergine entrega facturas simplificadas al huésped en `checkout` y en
`addCharge` con `issueInvoice=true`. Hoy el folio cierra sin emitir
factura formal — basta para fase de prototipo, pero el primer piloto
español necesita Verifactu o tendrá que mantener otro sistema de
facturación en paralelo.

Verifactu = un sistema que (resumido):

1. Numera facturas correlativamente.
2. Encadena cada registro con un hash del registro anterior (huella
   inmutable, tipo blockchain ligero).
3. Firma cada registro con el certificado digital del emisor (FNMT o
   representante).
4. Envía el registro firmado a un endpoint REST de la AEAT en <60s
   tras la emisión (art. 8 RD 1007/2023). Si falla, reintento «en
   cuanto sea posible».
5. Imprime el PDF de la factura con un QR que contiene el hash y el
   CSV/ID devuelto por AEAT.

Sin Verifactu, el hotelero comete infracción tributaria; con Verifactu
mal integrado, Aubergine es responsable subsidiariamente.

Cuatro decisiones operativas estaban abiertas en `SPRINT-14-PLAN.md §3.3`.
Este ADR las cierra y describe la arquitectura del módulo `verifactu/`.

---

## 2. Decisiones

### 2.1 Generación del PDF — **Puppeteer + plantilla HTML**

El PDF debe tener un hash de bytes estable (entra como dato en el
registro firmado AEAT). Eso descarta `window.print()` cliente. Entre
Puppeteer (Chromium headless) y `pdfkit`/`pdfmake` (libs JS puras),
elegimos **Puppeteer**:

- Render HTML real → reutilizable para reports futuros (W2 candidato:
  «Reports PDF + scheduling» comparte ADR puppeteer).
- Plantillas mantenibles por no-devs (HTML+CSS) vs. layout imperativo
  en JS.
- Calidad imprenta para QR + logo del hotel.

**Coste asumido:**
- Imagen Docker `pms-api` crece ~200 MB (chromium + fuentes).
- Cold start Fly +2–3 s. Mitigación: machine warmup ya configurado
  para `cdg`.
- Vulnerabilidades de chromium se parchean vía bump de
  `puppeteer` mensual (ya parte del CI Renovate).

**Alternativas descartadas:**
- HTML imprimible cliente — viola requisito de hash estable.
- `pdfkit` puro — layout más manual; no reutilizable para reports
  futuros; menos flexible para QR + branding.

### 2.2 Storage del certificado digital — **Fly volume cifrado + passphrase en Fly secret**

Cada hotel sube su certificado `.p12` (o `.pfx`) a través de
`/admin/billing/verifactu/certificate`. Persistencia:

- **At-rest:** archivo cifrado AES-256-GCM en `/data/verifactu/<tenantId>.p12.enc`
  (Fly volume montado en la máquina `pms-api`).
- **Key:** derivada (HKDF-SHA256) de un único Fly secret
  `VERIFACTU_MASTER_KEY` + `tenantId` como salt. Rotación del master
  key = re-cifrado batch documentado en RUNBOOK.
- **In-memory:** se descifra on-demand en cada firma; nunca se loguea;
  se libera tras uso (`Buffer.fill(0)` post-firma).
- **Passphrase del `.p12`:** el hotelero la introduce al subir; se
  cifra con la misma key y se guarda junto al cert. Nunca se muestra
  en UI tras guardar.

**Alternativas descartadas:**
- Vault externo (HashiCorp / AWS KMS) — añade dependencia y ~2 días de
  integración. Sobreingeniería para fase piloto (1–3 hoteles).
  Migración futura es contenida porque toda la criptografía vive en
  `CertificateVault` (interfaz). Reevaluable cuando el MRR > €5k.
- Upload por sesión (no persistido) — imposible cumplir el plazo
  <60 s del art. 8 si el hotelero no está conectado.

### 2.3 Modo desarrollo / staging — **Stub local SIEMPRE, real solo prod por env flag**

Adapter `AeatClient` con tres implementaciones intercambiables vía DI:

| Impl | Cuando | Comportamiento |
|---|---|---|
| `StubAeatClient` | `VERIFACTU_MODE=stub` o ausente | Valida el XML, computa hash, retorna CSV ficticio determinista. Imposible enviar a AEAT. |
| `PreprodAeatClient` | `VERIFACTU_MODE=preprod` | Apunta al endpoint de pre-producción de AEAT. Para QA. |
| `AeatClient` (real) | `VERIFACTU_MODE=production` **y** `NODE_ENV=production` | Endpoint real. Doble guarda para impedir envío accidental. |

El bootstrap del módulo `verifactu.module.ts` lanza error fatal si
`NODE_ENV=production` y `VERIFACTU_MODE !== production`. Y a la inversa:
si `VERIFACTU_MODE=production` con `NODE_ENV !== production`, también
falla (cinturón + tirantes).

**Alternativas descartadas:**
- Solo sandbox AEAT desde dev — requiere cert válido en dev, lentitud y
  rate limits de la AEAT-preprod cortan el ciclo TDD.
- Mock por env flag sin distinción dev/prod — riesgo alto de olvidar el
  flag y enviar real desde un test.

### 2.4 Fallback ante caída/lentitud AEAT — **Cola persistente + DLQ, factura emitida igual**

Conforme art. 8 RD 1007/2023: el envío debe hacerse «en cuanto sea
posible». La factura al huésped no se bloquea.

Flujo:

1. `InvoiceService.issue()` crea el registro `invoices` con estado
   `EMITTED`, computa hash, genera PDF, lo entrega al huésped.
2. Publica `invoice.submit_requested` en NATS JetStream (stream
   `verifactu`, durable consumer `submit-worker`).
3. `SubmitWorker` lo consume, llama `AeatClient.submit()`, marca:
   - éxito → `PENDING_SUBMIT` → `SUBMITTED` con `aeat_csv` guardado.
   - 4xx no-retry (factura inválida) → `REJECTED` + alerta op.
   - 5xx/timeout → `nak()` con backoff exponencial (max 6 intentos).
4. Tras 6 fallos consecutivos → DLQ `verifactu.dlq`. Alerta Grafana.
5. Folio puede cerrarse aunque la factura quede `PENDING_SUBMIT`;
   estado visible en `/billing/invoices`.

**Alternativas descartadas:**
- Fail-fast bloqueante — incompatible con operativa de hotel; AEAT cae
  con frecuencia conocida.
- Cola sin DLQ — perdemos visibilidad si una factura lleva >1 h
  colgada. Riesgo de incumplimiento del art. 8.

---

## 3. Forma del módulo

```
apps/api/src/verifactu/
  verifactu.module.ts
  config/
    verifactu.config.ts          ← modo, paths, master-key handle
  domain/
    invoice.entity.ts
    invoice-submission.entity.ts
    hash-chain.service.ts        ← cómputo SHA-256 encadenado
  application/
    invoice.service.ts           ← issue() + listar
    submit-worker.service.ts     ← consumer NATS
  infrastructure/
    aeat/
      aeat-client.interface.ts
      stub-aeat.client.ts
      preprod-aeat.client.ts
      real-aeat.client.ts
    certificate/
      certificate-vault.service.ts  ← AES-256-GCM + HKDF
      certificate.controller.ts     ← upload admin
    pdf/
      pdf-renderer.service.ts       ← puppeteer pool
      templates/
        simplified-invoice.html
  api/
    invoices.controller.ts        ← REST /billing/invoices
    dto/
  verifactu.events.ts             ← NATS subjects + payloads
  verifactu.spec.ts               ← suite top-level
```

Web (S14 W2, fuera de este ADR pero referenciado):

```
apps/web-fo/src/app/(authenticated)/billing/invoices/
  page.tsx                        ← listado
  [id]/page.tsx                   ← detalle + descargar PDF
apps/web-fo/src/app/(authenticated)/admin/billing/verifactu/
  certificate/page.tsx            ← upload + estado del cert
```

DB:

```
packages/db/prisma/schema.prisma
  + model Invoice
  + model InvoiceSubmission
  + model VerifactuCertificate
  + enum InvoiceStatus { EMITTED PENDING_SUBMIT SUBMITTED REJECTED }
  + enum AeatMode { STUB PREPROD PRODUCTION }
```

Migración `packages/db/prisma/migrations/<ts>_verifactu/migration.sql`,
forward-only, sin DROP. RLS por `tenant_id` en las tres tablas (CLAUDE.md §10).

Eventos NATS:

| Subject | Payload | Productor | Consumidor |
|---|---|---|---|
| `verifactu.invoice.submit_requested` | `{tenantId, invoiceId}` | `InvoiceService.issue()` | `SubmitWorker` |
| `verifactu.invoice.submitted` | `{tenantId, invoiceId, csv}` | `SubmitWorker` ok | observabilidad |
| `verifactu.invoice.rejected` | `{tenantId, invoiceId, reason}` | `SubmitWorker` 4xx | alerta + UI |

---

## 4. Consecuencias

### Positivas

- Hotel piloto puede operar legalmente desde el primer día de Verifactu
  obligatorio.
- Patrón `AeatClient` permite swap a Veri*factu* de otra CA, otra
  comunidad foral (Bizkaia TicketBAI ya tiene flujo análogo) sin
  re-arquitectura.
- Puppeteer queda disponible para reports PDF futuros (W2 candidato).

### Negativas

- Imagen Docker `pms-api` +200 MB.
- Cold start Fly +2–3 s.
- Operativa nueva en RUNBOOK: rotación de master key, restore de
  certificados, manejo de DLQ.
- Riesgo dependencia AEAT — mitigado por cola + DLQ pero exige
  monitorización activa.

### Riesgos abiertos (NO bloquean este ADR)

- **Cambios en el formato AEAT antes de 1-jul-2026.** Mitigación:
  versionar el XML en el envoltorio del adapter, suite de tests con
  fixtures fijos.
- **Validación cruzada con el censo AEAT** (NIF receptor) — fuera de
  scope V1. V2 si el piloto lo pide.
- **Factura rectificativa, abono, anulación** — fuera de scope V1.
  Tabla `invoices` admite `replaces_id`/`replaced_by_id` para
  habilitarlo sin migración futura.

---

## 5. Aprobación

- [x] Product Owner — Outman El Ouary Achi — 2026-05-29.
- [x] Scaffolding del módulo continúa en commits sucesivos sobre
      `claude/s14-w2-verifactu`.
