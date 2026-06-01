# PRD-000 — Aubergine PMS · Maestro

- **Status:** `Approved` (PO Outman El Ouary Achi, 2026-06-01)
- **Author:** PO Outman El Ouary Achi
- **Date:** 2026-06-01
- **Bloque maestro:** este documento ES el maestro
- **Related:** CLAUDE.md §1 (mission), todos los PRDs/RFCs/ADRs futuros
- **Sprint objetivo:** N/A — vive a lo largo de todos los sprints

> **Razón de ser:** evitar drift. Cualquier PRD nuevo debe encajar en
> uno de los bloques de este documento. Si no encaja, primero se
> amplía este PRD maestro (con aprobación del PO), luego se crea el PRD
> específico. Sin excepciones.

---

## 1 · Misión

Aubergine es un **PMS (Property Management System) AI-native para hoteles
boutique en España (30-150 habitaciones)** que debe operar como un PMS
comercial real, no como una demo.

Tres principios que ningún sprint puede contradecir:

1. **Hotel operations come first.** Cada decisión se juzga por si le
   hace el día más fácil al recepcionista real, no por elegancia técnica.
2. **Commercial-grade antes de florituras AI.** Reservas, folio, pagos,
   compliance deben ser rocosos antes de añadir demos AI nuevas.
3. **Multitenant por defecto.** Toda query, log, métrica, evento llevan
   `tenantId`. RLS Postgres no negociable.

---

## 2 · Para quién (público objetivo)

| Segmento | Tamaño | Características |
|---|---|---|
| **Boutique España (primario)** | 30-150 habs | Urbano o rural, sin gran cadena detrás, valoran diseño y trato cercano, pagan licencia mensual. |
| **B&B / hostería rural (secundario)** | 8-30 habs | Operación simple, sin restaurante propio, tarifa única o doble. |
| **Hostal urbano (terciario)** | 15-50 habs | Mayor rotación, sin grupos, sin TTOO. |

**Fuera de target:**

- Cadenas > 5 propiedades (V2).
- Resorts con MICE / banquetes / golf (no MVP).
- Hostels con dormitorios compartidos por cama (modelo distinto).
- Apartamentos turísticos sin recepción (modelo distinto).

---

## 3 · El gap — los 14 bloques

Estado a 2026-06-01. Marca legend:

- ✅ Implementado y en uso.
- ⚠ Implementado parcialmente / en estado de demo.
- ❌ No implementado.

### Bloque A · Reservas

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| A.1 | Reserva individual multi-huésped | ✅ | — | — |
| A.2 | Reserva de grupo con master folio + rooming list | ⚠ | TBD | TBD |
| A.3 | Allotments (cupos TTOO/agencia) | ❌ | — | — |
| A.4 | Bloques internos (boda, evento) | ❌ | — | — |
| A.5 | Walk-in | ✅ | — | — |
| A.6 | Waitlist | ❌ | — | — |
| A.7 | Overbooking controlado | ❌ | — | — |
| A.8 | Cambio de fechas con recálculo | ❌ | — | — |
| A.9 | Cambio de tipo de habitación con recálculo | ❌ | — | — |
| A.10 | Split de reserva | ❌ | — | — |
| A.11 | Merge de reservas | ❌ | — | — |
| A.12 | Reserva multi-habitación | ❌ | — | — |
| A.13 | Audit trail por reserva | ⚠ | — | — |

### Bloque B · Folio

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| B.1 | Folio único (open/close/reopen) | ✅ | — | — |
| B.2 | addCharge / addPayment con idempotencia | ✅ | — | — |
| B.3 | Multi-folio por reserva (huésped/empresa/agencia) | ❌ | — | — |
| B.4 | Master folio en grupos | ❌ | — | — |
| B.5 | Routing rules | ❌ | — | — |
| B.6 | IVA por línea con base imponible | ❌ | — | — |
| B.7 | City tax por noche × PAX | ❌ | — | — |
| B.8 | Descuentos por línea | ❌ | — | — |
| B.9 | Transfer de líneas entre folios | ❌ | — | — |
| B.10 | Split de líneas | ❌ | — | — |
| B.11 | Refunds parciales | ❌ | — | — |
| B.12 | Pre-pagos / depósitos con contabilidad | ❌ | — | — |
| B.13 | Multi-moneda con tipo de cambio histórico | ❌ | — | — |
| B.14 | Numeración correlativa al cerrar | ⚠ | — | — |

### Bloque C · Rates (tarifas y disponibilidad)

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| C.1 | Multi-rate plan (BAR, NO-REF, paquete, corporate) | ❌ | — | — |
| C.2 | Tarifas por temporada | ❌ | — | — |
| C.3 | Restricciones MLOS / MAXLOS / CTA / CTD / Closed | ❌ | — | — |
| C.4 | Override manual con motivo | ❌ | — | — |
| C.5 | Promociones / códigos descuento | ❌ | — | — |
| C.6 | Tarifas corporate negociadas | ❌ | — | — |
| C.7 | Paquetes como producto | ❌ | — | — |
| C.8 | Add-ons / extras (desayuno, parking, cuna, late checkout) | ❌ | — | — |

### Bloque D · Front Office

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| D.1 | Check-in / check-out | ✅ | — | — |
| D.2 | Cardex básico | ✅ | — | — |
| D.3 | Búsqueda inteligente (UI v2) | ⚠ | — | — |
| D.4 | Calendar drag-n-drop visual | ❌ | — | — |
| D.5 | Atajos de teclado | ❌ | — | — |
| D.6 | Pre-asignación de habitación | ❌ | — | — |
| D.7 | Auto-asignación por reglas | ❌ | — | — |
| D.8 | Upgrade flow con tracking | ❌ | — | — |
| D.9 | Self check-in móvil con escaneo de DNI/pasaporte | ❌ | — | — |
| D.10 | Self check-out móvil | ❌ | — | — |
| D.11 | Mensajería pre/in-stay (email/SMS/WhatsApp) | ⚠ | — | — |

### Bloque E · Housekeeping

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| E.1 | Board de tareas | ✅ | — | — |
| E.2 | PWA móvil | ✅ | — | — |
| E.3 | Estados de habitación (Clean/Dirty/Inspected/OOO/OOS) | ✅ | — | — |
| E.4 | Lost & Found con foto | ✅ | — | — |
| E.5 | Inspección con foto | ✅ | — | — |
| E.6 | Asignación automática por carga | ❌ | — | — |
| E.7 | Maintenance tickets vinculados a habitación | ❌ | — | — |
| E.8 | Minibar postable desde móvil | ❌ | — | — |
| E.9 | KPIs por camarera | ❌ | — | — |

### Bloque F · Night Audit

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| F.1 | Cierre diario automático | ✅ | — | — |
| F.2 | Snapshot inmutable | ✅ | — | — |
| F.3 | Roll-forward business date | ✅ | — | — |
| F.4 | Posting automático de room charges al cierre | ❌ | — | — |
| F.5 | Detección y cargo automático de no-shows | ❌ | — | — |
| F.6 | Manager flash report nocturno | ❌ | — | — |
| F.7 | Recálculo ADR/RevPAR del día | ⚠ | — | — |

### Bloque G · Pagos

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| G.1 | Stripe SetupIntent (tokenización SAQ A) | ✅ | — | — |
| G.2 | Garantía CARD_ON_FILE | ✅ | — | — |
| G.3 | Fallback client-side confirm | ✅ | — | — |
| G.4 | Cobro pre-stay automatizado | ❌ | — | — |
| G.5 | Pre-autorización al check-in | ❌ | — | — |
| G.6 | Cobro al check-out con multi-payment | ❌ | — | — |
| G.7 | Cobro de no-show automático | ❌ | — | — |
| G.8 | Refunds desde el PMS | ❌ | — | — |
| G.9 | Datafono físico (Redsys, Adyen Terminal) | ❌ | — | — |
| G.10 | Apple Pay / Google Pay | ❌ | — | — |
| G.11 | Transferencia con conciliación | ❌ | — | — |
| G.12 | Cash management (caja, arqueo, cierre turno) | ❌ | — | — |

### Bloque H · Compliance España

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| H.1 | SES.HOSPEDAJES producer + DLQ + auto-queue | ✅ | — | — |
| H.2 | Verifactu — esqueleto completo en modo stub | ✅ | — | RFC-pendiente |
| H.3 | Verifactu — preprod con XSD vigente + cert FNMT | ⚠ | — | — |
| H.4 | Verifactu — production | ⚠ | — | — |
| H.5 | Encuesta INE | ❌ | — | — |
| H.6 | Libro registro de huéspedes | ❌ | — | — |

### Bloque I · Channel Manager / OTAs

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| I.1 | Conector Booking.com 2-way | ❌ | — | — |
| I.2 | Conector Expedia 2-way | ❌ | — | — |
| I.3 | Conector Airbnb 2-way | ❌ | — | — |
| I.4 | Conector Hotelbeds 2-way | ❌ | — | — |
| I.5 | Mapeo room types / rate plans | ❌ | — | — |
| I.6 | ARI push en tiempo real | ❌ | — | — |
| I.7 | Detección double-booking | ❌ | — | — |

### Bloque J · IBE (Internet Booking Engine)

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| J.1 | Buscador público con disponibilidad real | ✅ | — | — |
| J.2 | Flujo de pago Stripe | ✅ | — | — |
| J.3 | Confirmación email (Postmark) | ✅ | — | — |
| J.4 | Portal "Gestionar mi reserva" | ✅ | — | — |
| J.5 | Selección de tarifa entre varias | ❌ | — | — |
| J.6 | Add-ons en el flujo de reserva | ❌ | — | — |
| J.7 | Multi-idioma (EN/FR/DE) | ❌ | — | — |
| J.8 | Pixels tracking (GA4, Meta) | ❌ | — | — |

### Bloque K · Periféricos

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| K.1 | PoS (TPV) restaurante/bar postable a folio | ❌ | — | — |
| K.2 | Door locks (Assa Abloy, Salto, Onity, Tesa) | ❌ | — | — |
| K.3 | Centralita telefónica con cargo a habitación | ❌ | — | — |
| K.4 | Wifi captive portal con identificación del huésped | ❌ | — | — |

### Bloque L · Reporting / BI

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| L.1 | Pickup report | ❌ | — | — |
| L.2 | Production by source | ❌ | — | — |
| L.3 | ADR / RevPAR / Occupancy diario, MTD, YTD | ❌ | — | — |
| L.4 | Forecast 30/60/90 días | ⚠ | — | — |
| L.5 | Manager flash diario | ❌ | — | — |
| L.6 | Reportes IVA (modelo 303, 390) | ❌ | — | — |
| L.7 | Dashboards configurables | ❌ | — | — |
| L.8 | Exportación CSV/Excel/PDF | ❌ | — | — |

### Bloque M · Multi-propiedad

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| M.1 | Un tenant con N hoteles | ❌ | — | — |
| M.2 | Reservas cross-property | ❌ | — | — |
| M.3 | Reporting consolidado | ❌ | — | — |
| M.4 | Cardex central | ❌ | — | — |
| M.5 | Roles por propiedad | ❌ | — | — |

### Bloque N · CRM / Cardex avanzado

| # | Función | Estado | PRD | RFC |
|---|---|---|---|---|
| N.1 | Perfil de huésped con historial agregado | ⚠ | — | — |
| N.2 | Preferencias del huésped | ❌ | — | — |
| N.3 | Segmentación VIP/repeat/corporate | ❌ | — | — |
| N.4 | Comunicaciones automatizadas pre/post stay | ⚠ | — | — |
| N.5 | Cumpleaños y fidelización | ❌ | — | — |
| N.6 | Encuestas post-stay con NPS | ❌ | — | — |

---

## 4 · Resumen numérico

| Bloque | Total | ✅ | ⚠ | ❌ |
|---|---|---|---|---|
| A · Reservas | 13 | 2 | 2 | 9 |
| B · Folio | 14 | 2 | 1 | 11 |
| C · Rates | 8 | 0 | 0 | 8 |
| D · Front Office | 11 | 2 | 2 | 7 |
| E · Housekeeping | 9 | 5 | 0 | 4 |
| F · Night Audit | 7 | 3 | 1 | 3 |
| G · Pagos | 12 | 3 | 0 | 9 |
| H · Compliance | 6 | 2 | 2 | 2 |
| I · Channel Manager | 7 | 0 | 0 | 7 |
| J · IBE | 8 | 4 | 0 | 4 |
| K · Periféricos | 4 | 0 | 0 | 4 |
| L · Reporting | 8 | 0 | 1 | 7 |
| M · Multi-propiedad | 5 | 0 | 0 | 5 |
| N · CRM avanzado | 6 | 0 | 2 | 4 |
| **TOTAL** | **118** | **23** | **11** | **84** |

84 funciones por construir, 11 por completar. Cada función es código, cada
código nace de un PRD específico de este maestro.

---

## 5 · Resultado esperado (success criteria del producto)

Aubergine se considera "PMS comercial real" cuando un hotel piloto de 50-80
habitaciones puede operar **sin recurrir a otro PMS** durante 30 días
consecutivos. Esto exige cubrir, como mínimo, este nivel por bloque:

- A: 1, 5, 8, 9, 13 (al menos cambio de fechas/hab y audit trail)
- B: 1-12 (todo menos multi-moneda)
- C: 1-4, 8 (multi-rate, temporada, restricciones, override, add-ons)
- D: 1-5 (FO completo + atajos)
- E: 1-7 (HSK + maintenance)
- F: 1-6 (NA con flash y no-show automation)
- G: 1-8, 12 (todo el ciclo de pago + caja)
- H: 1-4, 6 (SES + Verifactu real + libro)
- I: 1, 5-7 (al menos un canal 2-way real)
- J: 1-7 (IBE multi-idioma)
- L: 1-5, 8 (reporting operativo mínimo)

No requeridos para "PMS real" (V2): bloque K parcial, M, N parcial.

---

## 6 · Criterios de aceptación funcionales (a nivel maestro)

Un piloto real puede demostrar, en 30 días sin caídas críticas:

1. Reservar 50 habitaciones-noche desde IBE + 50 desde back-office +
   30 desde un canal 2-way, sin double-booking.
2. Cerrar 80 folios con multi-folio (huésped/empresa), IVA por línea
   correcto, city tax aplicado, factura Verifactu enviada a AEAT en
   < 60 s y QR impreso.
3. Hacer noche cerrada (NA) 30 noches consecutivas sin discrepancias
   contables al día siguiente.
4. Manejar 5 grupos (boda, congreso, ...) con master folio + rooming list.
5. Reportar pickup, ADR, RevPAR y occupancy diarios sin recurrir a Excel.
6. SES.HOSPEDAJES al día, sin entradas en DLQ > 24h.
7. Cero incidencias PCI / GDPR.

---

## 7 · Fuera de alcance (del PMS comercial)

- Resorts > 200 habs (escala distinta de aforo/concurrencia).
- MICE / banquetes / contratos de eventos complejos.
- Spa / golf / tee times / wellness scheduling.
- Loyalty con puntos canjeables multi-propiedad.
- Distribución a metasearch (Trivago, Kayak) — V2.
- Mercados fuera de España (V2).
- Integraciones con ERP financiero (Sage, A3, ...).

---

## 8 · Dependencias y bloqueos a nivel maestro

- **Verifactu producción** depende de: cert FNMT-RCM, alta AEAT del PMS
  con `IdSistemaInformatico`, XSD vigente. Sin estos, máximo `stub`.
- **Channel manager** depende de credenciales por hotel piloto.
- **PoS / door locks** dependen de proveedor concreto del hotel piloto.
- **Multi-property** depende de tener ≥ 1 piloto cadena.

---

## 9 · Métricas a instrumentar (a nivel producto)

- `reservation.created` por origen (FO / IBE / OTA / walk-in)
- `folio.closed` con `tenantId`, `totalAmount`, `vatBreakdown`
- `payment.captured` por método y motivo
- `verifactu.submission.success_rate` por tenant
- `night_audit.completion_time_ms` por tenant
- `ibe.conversion_rate` por tenant
- `hsk.room_turnover_minutes` por tenant
- `copilot.tool_usage` por tool y por tenant

Cardinalidad de `tenantId` controlada (≤ 200 tenants previstos en V1).

---

## 10 · Riesgos de producto

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Drift hacia features AI no pedidas por el hotelero | Alta | Alto | PROCESS.md §6 anti-drift + este PRD maestro como ancla. |
| Sobreingeniería de bloques M y N antes de los críticos A-G | Media | Alto | Orden estricto: A-G antes que el resto, salvo cuando bloquean piloto. |
| Compliance retrasa el piloto (cert FNMT, alta AEAT) | Alta | Medio | `VERIFACTU_ALLOW_STUB_IN_PROD=true` para piloto pre-facturación; track paralelo de trámites con PO. |
| Hotel piloto cambia de PMS por una función bloque ❌ | Alta | Alto | Encuesta de "must-have" al piloto antes de cerrar trato; cerrar gaps críticos primero. |

---

## 11 · Alternativas consideradas

### 11.1 · Reposicionar como "AI Copilot para PMS existentes"

Descartado: pierde el control del dato del huésped y el moat operativo.
Aubergine deja de ser un PMS.

### 11.2 · Foco en hoteles < 30 habs como mercado primario

Posible pivot futuro si el bloque A-G se cierra rápido pero los hoteles
medianos no muerden. Hoy no es el plan.

### 11.3 · Construir microservicios desde el inicio

Descartado por CLAUDE.md §1: monolito modular hasta probar volumen.

---

## 12 · Firma

- **PO:** _Outman El Ouary Achi · 2026-06-01_
- **Tech lead:** _Claude Code (asistente) — implementa, no firma_

Este PRD se actualiza por PR. Cualquier ampliación del scope (nueva
columna en la tabla de bloques, cambio de prioridad) entra por PR
explícito firmado por el PO. Modificaciones silenciosas son razón de
revert.

---

## Apéndice A · Plantilla de slot para un PRD específico

Cuando se cree un PRD nuevo (ej. PRD-001 — "Multi-folio en reservas"),
se actualiza la tabla del bloque correspondiente con el número de PRD:

```diff
- | B.3 | Multi-folio por reserva (huésped/empresa/agencia) | ❌ | — | — |
+ | B.3 | Multi-folio por reserva (huésped/empresa/agencia) | ❌ | PRD-001 | RFC-007 |
```

Y cuando se hace `Shipped`, se actualiza el estado:

```diff
- | B.3 | Multi-folio por reserva (huésped/empresa/agencia) | ❌ | PRD-001 | RFC-007 |
+ | B.3 | Multi-folio por reserva (huésped/empresa/agencia) | ✅ | PRD-001 | RFC-007 |
```
