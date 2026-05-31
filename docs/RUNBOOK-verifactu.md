# RUNBOOK — Verifactu (e-invoicing AEAT)

> Operativa diaria + troubleshooting del módulo Verifactu.
> Para arquitectura, ver `docs/adr/030-verifactu-architecture.md`,
> `031-verifactu-xades-library.md`, `032-verifactu-xml-payload.md`.

---

## 1. Mapa rápido

**Bucle end-to-end:**

```
operador (UI)                       backend                         AEAT
─────────────                       ───────                         ────
1. Configura emisor    ─────────►  Tenant.nif/razonSocial
   /admin/billing/emisor

2. Sube .p12           ─────────►  CertificateVaultService
   /admin/billing/cert              cifra con AES-GCM, guarda

3. Cierra folio        ─────────►  InvoiceService.issue()
   /reservations/[id]               valida emisor + cert,
                                    calcula huella,
                                    persiste Invoice + Submission
                                    publica submit_requested

                                   SubmitWorker (consumer NATS)
                                    buildVerifactuRegistroAlta()
                                    SignerService (XAdES-BES)  ──► AeatClient.submit()
                                                                   (stub | preprod | prod)
                                    marca ACCEPTED / REJECTED
                                    publica submitted / rejected

4. Ve resultado        ◄─────────  InvoicePanel + histórico
   /reservations/[id]              (auto-revalida)
```

**Tres modos** (`VERIFACTU_MODE`):

| Modo         | Red       | Auth     | Para qué                                  |
| ------------ | --------- | -------- | ----------------------------------------- |
| `stub`       | no        | n/a      | dev local, CI, demos sin AEAT             |
| `preprod`    | HTTP      | mTLS¹    | smoke real contra entorno AEAT pruebas    |
| `production` | HTTP      | mTLS¹    | producción real, solo NODE_ENV=production |

¹ mTLS pendiente de implementar — ver §7.4.

---

## 2. Variables de entorno

| Variable                            | Default                | Obligatoria en       | Comentario |
| ----------------------------------- | ---------------------- | -------------------- | ---------- |
| `VERIFACTU_MODE`                    | `stub`                 | -                    | `stub` \| `preprod` \| `production` |
| `VERIFACTU_MASTER_KEY`              | -                      | preprod, production  | ≥ 32 chars. **NUNCA rotar a la ligera** — invalida todos los .p12 cifrados. Ver §6.2. |
| `VERIFACTU_CERT_DIR`                | `/data/verifactu`      | preprod, production  | Volumen persistente, mode 0700. |
| `VERIFACTU_AEAT_ENDPOINT`           | -                      | preprod, production  | URL servicio web AEAT. Ver `docs/adr/031` §G. |
| `VERIFACTU_AEAT_TIMEOUT_MS`         | `15000`                | -                    | Timeout HTTP por intento. |
| `VERIFACTU_SISTEMA_NOMBRE_RAZON`    | `Aubergine PMS S.L.`   | production           | Razón social del fabricante (nuestra). |
| `VERIFACTU_SISTEMA_NIF`             | `B00000000`            | production           | NIF Aubergine PMS, S.L. |
| `VERIFACTU_SISTEMA_NOMBRE`          | `Aubergine PMS`        | -                    | Nombre comercial constante. |
| `VERIFACTU_SISTEMA_ID`              | `01`                   | production           | Asignado por AEAT al registrar el SIF. |
| `VERIFACTU_SISTEMA_VERSION`         | `0.1.0`                | -                    | Versión del PMS — bumpea en cada release que toca Verifactu. |

Guards del bootstrap (`VerifactuModule.onModuleInit`):

- `NODE_ENV=production` + `VERIFACTU_MODE≠production` → throw.
- `VERIFACTU_MODE=production` + `NODE_ENV≠production` → throw.
- `VERIFACTU_MODE≠stub` + master key ausente → throw.
- `VERIFACTU_MODE≠stub` + endpoint vacío → throw.

---

## 3. Bootstrap (qué configurar antes de emitir la primera factura)

### 3.1 Bootstrap del módulo (admin sistema)

1. Generar `VERIFACTU_MASTER_KEY`:
   ```
   openssl rand -hex 32   # 64 chars hex = 32 bytes
   ```
   Guardar en gestor de secretos. **Esta clave protege todos los .p12**.
2. Crear directorio para los certificados (Fly: volumen `verifactu-certs` montado en `/data/verifactu`).
3. (preprod/production) Configurar `VERIFACTU_AEAT_ENDPOINT` + `VERIFACTU_SISTEMA_*` con valores reales (ver `docs/adr/032` §6).
4. Desplegar.

### 3.2 Bootstrap del tenant (operador del hotel)

1. Login como `tenant_admin`.
2. **Configurar emisor**: `/admin/billing/emisor` → NIF + razón social.
3. **Subir certificado digital**: `/admin/billing/certificate` →
   seleccionar `.p12` + introducir passphrase.
   - Sin certificado, `SignerService.sign()` lanza `NotFoundException`.
4. Hacer un check-out + cerrar folio + **Emitir factura** desde
   `/reservations/[id]`. Verificar que aparece en el histórico de envíos
   con estado `ACCEPTED` (y CSV poblado si modo preprod/production).

### 3.3 Verificar bootstrap con el health-check

Antes de pasar el tenant a uso real (o cuando soporte reporta
"no me deja emitir"), ejecutar el script de diagnóstico:

```sh
# Todos los tenants:
DIRECT_URL=postgres://... pnpm tsx scripts/verifactu-health-check.ts

# Uno solo (para soporte puntual):
DIRECT_URL=postgres://... pnpm tsx scripts/verifactu-health-check.ts \
  --tenant 00000000-0000-0000-0000-000000000000

# JSON para integrar con monitoring / alerting:
DIRECT_URL=postgres://... pnpm tsx scripts/verifactu-health-check.ts --json
```

Reporta por tenant: emisor, cert (días a caducidad), últimas 10
facturas por estado, DEAD_LETTER en últimos 30 días. Overall 🟢/🟡/🔴.

**Estados que reporta como 🔴 (fail):**

| Síntoma                                | Acción                                              |
| -------------------------------------- | --------------------------------------------------- |
| `Emisor: NOT SET`                      | Operador en `/admin/billing/emisor`. Ver §5.1.      |
| `Cert: NOT UPLOADED`                   | Operador en `/admin/billing/certificate`. Ver §5.2. |
| `Cert: REVOKED`                        | Subir uno nuevo. Ver §5.3.                          |
| `Cert: EXPIRED`                        | Renovar con FNMT-RCM. Ver §5.8.                     |
| `Cert: caduca en <30d`                 | Renovar con FNMT-RCM **ya**. Ver §5.8.              |
| `DLQ 30d: N` con `N > 0`               | Revisar `error_message` de los DEAD_LETTER y       |
|                                        | reintentar desde UI cuando aplique. Ver §5.6.       |

Exit codes:
- `0` — todos OK.
- `1` — al menos uno en fail (cualquier 🔴).
- `2` — error de conexión / DB.

Útil para cron diario en producción → alerta si exit != 0.

---

## 4. Operaciones diarias del operador

### 4.1 Emitir factura

`/reservations/[id]` → panel "Factura Verifactu" → formulario "Emitir factura". Pre-requisitos:

- Folio en estado `CLOSED` o `SETTLED`.
- Tenant tiene NIF + razón social.
- Tenant tiene certificado vigente subido.

Resultado esperado: badge `issued` → `submitted` → `accepted` en pocos
segundos. Si no llega a `accepted`, ver §5.

### 4.2 Reintentar envío

Cuando el último intento aparece como `REJECTED` o `DEAD_LETTER`,
aparece el botón **Reintentar envío** en la cabecera del histórico.

**No se permite reintentar** si:
- La factura está ya `ACCEPTED` (no tiene sentido).
- Hay un intento `PENDING` o `IN_PROGRESS` (esperar).

Reintentar republica el evento `verifactu.invoice.submit_requested`.
El SubmitWorker creará una nueva `InvoiceSubmission` con
`attemptNumber++`.

### 4.3 Revocar certificado

`/admin/billing/certificate` → botón **Revocar** + motivo (≥ 3 chars).

Marca el certificado como revocado en DB. **No borra el .p12 cifrado
del disco** (auditoría). A partir de la revocación,
`SignerService.sign()` lanza `BadRequestException` hasta que se suba
uno nuevo.

---

## 5. Troubleshooting

### 5.1 "Tenant missing NIF or razón social"

→ Operador olvidó el paso 2 de §3.2. Ir a `/admin/billing/emisor`.

### 5.2 "No certificate for tenant {uuid}"

→ Operador olvidó el paso 3 de §3.2. Ir a `/admin/billing/certificate`.

### 5.3 "Certificate is revoked"

→ Subir uno nuevo en `/admin/billing/certificate`. El upload
re-activa (limpia `revokedAt` + `revokedReason`).

### 5.4 "VERIFACTU_MASTER_KEY no configurada"

→ Operativo. El módulo no puede ni cifrar (upload) ni descifrar
(firma). Configurar la env var y reiniciar.

### 5.5 Submission queda en `PENDING` indefinidamente

Posibles causas:
- **NATS down**: ver health-check `EventbusService.isHealthy()`.
- **Worker desactivado**: revisar logs por
  `SubmitWorker disabled (test env)` — `NODE_ENV` mal configurada.
- **Consumer no se suscribió**: log debe decir
  `SubmitWorker subscribed to verifactu.invoice.submit_requested`.

Manualmente:
```sql
SELECT id, attempt_number, status, queued_at, started_at, last_error
FROM invoice_submissions
WHERE invoice_id = '<uuid>'
ORDER BY attempt_number DESC;
```

### 5.6 Submission queda en `DEAD_LETTER`

El worker agotó los 5 intentos. Causas comunes:
- Cert revocado entre intentos → subir uno nuevo + reintentar desde UI.
- Endpoint AEAT caído > 5 reintentos → reintentar desde UI cuando AEAT
  vuelva.
- Bug en el generador / firma → revisar `error_message` de la última
  submission. Si es genuinamente un bug, hotfix + reintento.

Reintento manual desde UI: §4.2.

### 5.7 AEAT responde `REJECTED` por validación

`error_message` típicamente contiene `CodigoErrorRegistro` +
`DescripcionErrorRegistro`. Códigos conocidos:

| Código (ej) | Significado                          | Acción |
| ----------- | ------------------------------------ | ------ |
| 4102        | NIF inválido (cliente o emisor)      | Corregir en `/admin/billing/emisor` o reabrir factura. |
| Otros       | Ver guía técnica AEAT publicada.     | Si es por payload, hotfix `buildVerifactuRegistroAlta()`. |

Reintentar **no** ayuda si el rechazo es por validación de negocio —
hay que rehacer la factura.

### 5.8 Cert caduca pronto

`/admin/billing/certificate` muestra:
- Badge verde si quedan > 90 días.
- Badge ámbar si quedan ≤ 90 días.
- Badge rojo si quedan ≤ 30 días o ya caducado.

Renovar con FNMT-RCM (ver `docs/adr/032` Paso 1 del bootstrap) y subir
el nuevo `.p12` desde la misma pantalla. El upload reemplaza la fila
en DB y el blob en disco.

---

## 6. Operaciones admin (poco frecuentes)

### 6.1 Renovación de certificado de tenant

1. Operador renueva con FNMT-RCM (ver guía PO).
2. Sube el `.p12` nuevo en `/admin/billing/certificate`.
3. El upload hace `upsert` por tenant: limpia `revokedAt`, actualiza
   metadata, reescribe el blob cifrado.
4. La siguiente factura emitida usa el cert nuevo automáticamente.

**No requiere downtime.**

### 6.2 Rotación de `VERIFACTU_MASTER_KEY`

**Procedimiento delicado** — la nueva master key no descifra los .p12
cifrados con la vieja. Pasos:

1. Decidir ventana de mantenimiento.
2. Para cada tenant: pedir al operador que vuelva a subir el `.p12`
   con la NUEVA master key (env var ya cambiada).

   Alternativa scriptable:
   ```sh
   # En la máquina con AMBAS keys disponibles:
   #  1) Leer blob cifrado, descifrar con vieja, re-cifrar con nueva.
   #  2) Sobrescribir el blob en disco.
   # (script de migración pendiente — `scripts/rotate-verifactu-master-key.ts`)
   ```
3. Antes de reiniciar la API con la nueva key, hacer backup del
   directorio `/data/verifactu`.
4. Reiniciar la API con `VERIFACTU_MASTER_KEY=<nueva>`.

### 6.3 Bump de versión del PMS ante AEAT

Cuando hay cambios sustanciales (no parches) en el generador o
firma, AEAT pide notificar nueva versión del SIF.

1. Actualizar `VERIFACTU_SISTEMA_VERSION` en el `.env` de producción.
2. Notificar a AEAT por su trámite electrónico
   (sede.agenciatributaria.gob.es → SIF).
3. El cambio aparece en el siguiente `<SistemaInformatico>` que se
   serialice.

### 6.4 Alta de un nuevo SIF (primer despliegue producción)

Pre-requisito antes de poder enviar a `production`. Ver
`docs/adr/032` §6 + Paso 3 de bootstrap. Una vez AEAT devuelve el
`IdSistemaInformatico`, lo metes en `VERIFACTU_SISTEMA_ID` del `.env`.

---

## 7. Estado actual de la implementación (snapshot S14 W2)

### 7.1 ✅ Implementado

- Vault de certificados AES-256-GCM + PBKDF2.
- `InvoiceService.issue()` con emisor + huella encadenada + lock
  secuencial doble (`pg_advisory_xact_lock`).
- `buildVerifactuRegistroAlta()` conforme a la estructura RD 1007/2023 +
  Orden HAC/1177/2024.
- `SignerService` XAdES-BES via `xadesjs`.
- `SubmitWorker` con retry exponencial + DLQ + idempotencia.
- `StubAeatClient` (determinista) + `PreprodAeatClient` (HTTP).
- UI: `/admin/billing/emisor`, `/admin/billing/certificate`,
  panel emit + histórico + reintento en `/reservations/[id]`.

### 7.2 ⚠ Pendiente de verificación contra XSD oficial

Los marcadores `⚠` en `invoice-xml.ts` y `preprod-aeat-client.ts`
identifican nombres de elementos cuyo nombre exacto puede variar entre
versiones del schema AEAT. Antes de envío real a producción, validar
uno por uno contra el XSD vigente (ver `docs/adr/032` §G).

### 7.3 ⏳ Pendiente de implementar

- **mTLS en `PreprodAeatClient`** (§7.4).
- **IVA por línea** — hoy el `Desglose` emite un único `DetalleDesglose`
  al 10% alojamiento. Sprint dedicado para modelar tipo de IVA en cada
  `FolioEntry`.
- **Rectificativas (R1-R5)** — bloqueadas en `InvoiceService.issue()`
  con `BadRequest`. Sprint dedicado.
- **Script de rotación de master key** (§6.2).

### 7.4 mTLS

`PreprodAeatClient` hoy abre HTTP plano. AEAT exige mTLS con el cert
del emisor. Plan de implementación (cuando lleguen credenciales PO):

1. Inyectar `CertificateVaultService` en `PreprodAeatClient`.
2. Por request, cargar el `.p12` del tenant
   (`vault.loadDecryptedP12(request.tenantId)`).
3. Extraer key + cert (reusar helper de `signer.service.ts`).
4. Crear `undici.Agent({ connect: { key, cert } })`.
5. Pasar como `dispatcher` al `fetch(url, { dispatcher })`.

El resto del cliente (parsing, timeouts, error handling, worker
integration) ya está listo.

---

## 8. Health-check + métricas

`GET /health` incluye el estado del eventbus. No hay endpoint
específico Verifactu — el módulo no abre puertos propios.

Métricas OpenTelemetry expuestas por el `SubmitWorker` (meter
`pms-api/verifactu`):

- **`verifactu_submit_total`** (Counter). Labels:
  - `outcome`: `accepted | rejected | sign_error_nak |
    sign_error_dead_letter | aeat_error_nak | aeat_error_dead_letter |
    invariant_violated | invoice_not_found | idempotent_ack`.
  - `mode`: `stub | preprod | production`.
- **`verifactu_submit_duration_ms`** (Histogram, ms). Mismas labels.
  Mide el handler completo desde `findUnique(Invoice)` hasta return.

Alertas sugeridas en Grafana (TODO `infra/grafana/dashboards/verifactu.json`):
- Tasa `outcome=*dead_letter` > 0 en 5 min → page (algo bloqueado).
- Tasa `outcome=rejected` sostenida > umbral → review (AEAT validando
  duro algo del payload).
- p95 `verifactu_submit_duration_ms{mode=preprod}` > 30s → page.

---

_Maintainer: este runbook se actualiza vía PR como cualquier doc.
Tareas operativas nuevas → entrada propia. Errores nuevos → §5 con
código + mensaje exacto + acción._
