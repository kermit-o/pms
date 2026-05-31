# ADR-031 — Librería para firma XAdES-BES de facturas Verifactu

- **Status:** Proposed (PO decide — esta ADR no se ejecuta hasta firmar).
- **Date:** 2026-05-30
- **Sprint:** S14 W2 (`claude/s14-w2-verifactu`)
- **Driver:** RD 1007/2023 + Orden HAC/1177/2024 exigen que cada factura
  enviada a AEAT vaya firmada XAdES-BES enveloped. El signer actual
  (`apps/api/src/verifactu/signer.service.ts`) emite XMLDSig estándar —
  suficiente para dev/stub, **insuficiente para AEAT preprod o producción**.
- **Related:** ADR-030 (arquitectura Verifactu), CLAUDE.md §8 (deps
  externas requieren aprobación).

---

## 1. Contexto

El estado actual del módulo:

- `SignerService` produce una firma RSA-SHA256 con `<ds:SignedInfo>`,
  `<ds:SignatureValue>`, `<ds:KeyInfo>` (X509). Round-trip criptográfico
  verificado en tests.
- **Falta** el envoltorio XAdES-BES que el validador AEAT exige:
  - `<ds:Object><xades:QualifyingProperties Target="#sig-...">`.
  - Segunda `<ds:Reference URI="#xades-SignedProperties"
Type="http://uri.etsi.org/01903#SignedProperties">`.
  - `<xades:SignedProperties Id="xades-SignedProperties">` con
    `<xades:SigningTime>` y `<xades:SigningCertificate>` (CertDigest +
    IssuerSerial).
- Canonicalización: la spec AEAT cita C14N 1.0 — pero los validadores
  reales son **notoriamente estrictos** con bytes idénticos (manejo de
  prefijos de namespace, atributos por orden alfabético, espacios en
  blanco). Un byte distinto = rechazo silencioso.

Tres caminos para cerrar el gap. Esta ADR los compara y propone uno.

---

## 2. Opciones

### 2.1 `xadesjs` — purpose-built XAdES

- npm: `xadesjs` 2.6.7 · MIT · 262 KB unpacked · ~50k downloads/semana.
- Mantenedor: **PeculiarVentures** (mismos autores de `@peculiar/x509`,
  usado por Microsoft; track record sólido en crypto-XML).
- Deps: `xml-core` + `xmldsigjs` (que arrastra 7 deps adicionales —
  polyfills WebCrypto, ASN.1, etc.). En total ~12 paquetes nuevos en
  el lock file.
- Construido **específicamente** para XAdES (BES, EPES, T, C, X, X-L,
  A). Soporta todos los SignedProperties que vamos a necesitar.

**Pros:**

- Mínimo código nuestro: ~50 LOC de glue + plantilla de
  SignedProperties.
- Las canonicalizaciones C14N (inclusiva + exclusiva) están bien
  testadas — la comunidad XAdES europea (eIDAS, FacturaE española)
  ha pasado por aquí.
- TypeScript first.

**Contras:**

- Mayor superficie de dependencias (12 paquetes).
- Documentación pública escasa: hay que leer código y tests para los
  casos AEAT-específicos.
- Usa Web Crypto API → Node ≥16 nativo, OK con nuestra base (Node 20).

### 2.2 `xml-crypto` + wrapper XAdES manual

- npm: `xml-crypto` 6.1.2 · MIT · 286 KB unpacked · ~700k downloads/semana.
- Mantenedor: **node-saml** org. Battle-tested en autenticación SAML
  desde hace años.
- Deps: 3 paquetes (`@xmldom/is-dom-node`, `@xmldom/xmldom`, `xpath`).

**Cubre solo XMLDSig**, no XAdES. Para cumplir la spec habría que:

- Construir `<xades:QualifyingProperties>` a mano.
- Calcular el digest de `<xades:SignedProperties>` con la
  canonicalización que el verificador AEAT espere.
- Añadirlo como segunda Reference en SignedInfo.

**Pros:**

- Dep maduras + 14× más adopción que xadesjs.
- Mantenemos control sobre la estructura XAdES exacta.
- Menos arrastre de dependencias.

**Contras:**

- ~150-250 LOC de wrapper XAdES nuestro = misma superficie de bugs que
  la opción 3 en la parte XAdES (la parte XMLDSig sí gana frente a la
  opción 3).
- Sin testbench público de "este wrapper pasa AEAT" → time-to-green
  potencialmente largo.

### 2.3 Implementación propia con `node-forge` (sin nuevas deps)

- 0 deps nuevas. Reutilizamos `node-forge` (ya en el proyecto desde el
  vault del certificado).

Habría que escribir:

- Canonicalización C14N 1.0 (~150 LOC, con sus aristas: namespace
  prefixes heredados, `xml:space`, ordenación de atributos).
- Construcción de SignedInfo + SignedProperties + QualifyingProperties
  (~150 LOC).
- Cálculo de digests + binding por URI/Id (~50 LOC).
- Total ~400 LOC + suite de tests con vectores de XML-DSIG (publicados
  por W3C) para validar la canonicalización.

**Pros:**

- Sin nuevas deps → coste cero en supply chain, simpler lock file.
- Control total: cuando AEAT cambie su validador podemos adaptar
  rápido sin esperar a un release upstream.

**Contras:**

- C14N tiene casos esquina que llevan **semanas** de depuración cuando
  una factura es rechazada por byte-mismatch.
- Sin comunidad que use el código = nadie te avisa de un bug latente.
- Coste de desarrollo: estimo 2-3 días de implementación + 1-2 días de
  debugging contra AEAT preprod, optimistamente.

---

## 3. Comparación rápida

| Criterio                  | xadesjs           | xml-crypto+wrapper | Propio (node-forge) |
| ------------------------- | ----------------- | ------------------ | ------------------- |
| Deps nuevas               | ~12               | 3                  | 0                   |
| LOC propio                | ~50               | ~200               | ~400                |
| Cobertura XAdES nativa    | Completa          | Manual             | Manual              |
| Riesgo C14N               | Bajo              | Bajo               | Alto                |
| Riesgo XAdES specifics    | Bajo              | Medio              | Alto                |
| Mantenimiento de la dep   | Activo (Peculiar) | Muy activo (SAML)  | N/A                 |
| Coste salir si vendor cae | Medio             | Bajo (XMLDSig OK)  | N/A                 |
| Tiempo a "preprod verde"  | ~0.5 día          | ~2 días            | ~3-5 días           |

---

## 4. Recomendación

**Opción 1: `xadesjs`.**

Razonamiento corto:

- El bloqueo en pasar el validador AEAT es C14N exacta + estructura
  XAdES exacta. Ambas son **problemas resueltos** por la opción 1, y
  **problemas abiertos** por las otras dos.
- El coste en supply chain (~12 deps) es real pero acotado:
  PeculiarVentures es el responsable de buena parte del stack
  WebCrypto en Node y navegadores; no es un mantenedor amateur.
- El time-to-green frente a preprod (estimado 0.5 día vs. 3-5 días en
  la opción 3) **liberará al PO** para validar otras piezas del flujo
  (PDF QR, e2e en folio, etc.).
- Si AEAT cambia la spec, xadesjs suele ir por delante (la usa parte
  del ecosistema FacturaE/eIDAS).

**Fallback ordenado:** si en code-review o supply-chain-audit la opción
1 no convence (p.ej. PO prefiere minimizar deps), opción 2
(`xml-crypto` + wrapper) es aceptable; tomaría ~2 días extras.

**Descartado:** opción 3 — el coste de desarrollo + debug AEAT no
compensa cuando hay alternativas mantenidas. Se reconsiderará solo si
las opciones 1 y 2 fallan en preprod por un bug que upstream no quiera
arreglar.

---

## 5. Plan de implementación si se aprueba xadesjs

Estimado: ~0.5 día de código + 0.5 día integración preprod.

1. **Aprobación PO** + commit que añade `xadesjs` (+ `@types/xadesjs`
   si existe; si no, declaración local) — diff aislado.
2. **Refactor `SignerService.sign()`** para producir XAdES-BES:
   - Sustituir la construcción manual de `<ds:Signature>` por una
     llamada a `xadesjs.SignedXml`.
   - Configurar policy `BES` con SigningTime + SigningCertificate.
   - Mantener la entrada/salida del servicio igual (no se rompe el
     `SubmitWorker`).
3. **Test de integración**: el round-trip existente sigue verificando
   la firma; añadimos un test que parsea el XAdES resultante y verifica
   que existe `<xades:SignedProperties>` y que su digest coincide con
   la segunda `<ds:Reference>`.
4. **Smoke test contra AEAT preprod** (requiere credenciales + cert de
   pruebas; el PO los gestiona).

---

## 6. Decisiones abiertas para el PO

1. **¿Apruebas la dep `xadesjs`?** (Sí → procedo; No → opción 2.)
2. **Cuándo facilitas credenciales AEAT preprod** + cert de pruebas
   FNMT-RCM. Sin eso el PreprodAeatClient se queda en stub.
3. **¿Vendor lock-in tolerable?** Si te preocupa, opción 2 minimiza
   riesgo de salida.

---

## 7. Consecuencias

Si se acepta:

- `apps/api/package.json` gana `xadesjs` como dep runtime.
- `SignerService` deja de producir XMLDSig "pelado" y pasa a XAdES-BES
  completo — cambio interno transparente al `SubmitWorker`.
- DELIVERY-LOG documentará la sustitución del signer.

Si se rechaza:

- Esta ADR vuelve a Proposed con una opción alternativa marcada y se
  reescribe (mismo formato).
- El `SubmitWorker` seguirá funcionando contra `StubAeatClient` hasta
  que haya una decisión.

---

_Maintainer: este ADR se modifica vía PR como cualquier otro fichero
del repo. Una vez Accepted, las decisiones no se cambian — se
superseden con una nueva ADR._
