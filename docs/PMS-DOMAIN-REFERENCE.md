# PMS Domain Reference — Aubergine

> Mapa mental del dominio "hotel PMS" para no perder de vista cómo encajan
> las piezas y diseñar el roadmap sin atropezos. Documento vivo — actualizar
> tras cada hito (no se cierran sprints sin reflejar lo entregado aquí).

## 0. Qué es un PMS

Un **Property Management System** es el sistema operativo del hotel. Cubre
todo el ciclo de vida del huésped desde el booking hasta el checkout, más la
parte fiscal/legal y la coordinación interna (housekeeping, mantenimiento,
F&B). No es solo "una agenda de reservas" — es la columna vertebral
operativa, contable, comercial y de compliance.

Las grandes familias funcionales:

| Familia | Qué resuelve | Estado Aubergine |
|---|---|---|
| **Reservas (CRS)** | Captar, modificar, cancelar reservas | ✅ Phase 1+2 + grupos |
| **Front Office** | Check-in/out, walk-ins, asignación habitación, llaves | ✅ Básico + arrivals/departures/in-house |
| **Rates & Inventory** | Tarifas, restricciones, disponibilidad, channel mgr | 🟡 Básico (rate plans, sin restricciones) |
| **Folio & Cashier** | Cargos, pagos, cuenta del huésped, splits | 🟡 Cargos manuales, sin folios maestros |
| **Housekeeping** | Estado habitación (clean/dirty/inspected), partes | 🟡 Cambio de estado manual |
| **Night Audit** | Cierre del día, posting automático, reporting | ✅ Implementado |
| **Reporting** | Ocupación, ADR, RevPAR, pickup, source mix | 🟡 Reportes básicos |
| **Guest Profiles (Cardex)** | Histórico, preferencias, membership, GDPR | ✅ Básico |
| **Compliance Spain** | SES.HOSPEDAJES, IVA, factura, libro registros | 🟡 Stub SES, falta productivo |
| **Garantías & Pagos** | Card-on-file, depósitos, no-show, refund | ✅ Stripe SetupIntent (Fase 1) |
| **Comercial (B2B)** | Agencias, empresas, contratos, comisión, allotment | 🟡 Falta agencia/empresa real |
| **AI Layer (Aubergine)** | Copilot, smart search, voice HSK, anomalías | ✅ Copilot, smart search |

---

## 1. Modelo de datos — entidades centrales

Diagrama de "quién depende de quién" (las flechas indican dependencia
de datos):

```
Tenant ──┬── Hotel(es)
         ├── User(es) (front desk, housekeeping, admin)
         └── Configuración (impuestos, monedas, políticas)

Hotel ──┬── RoomType (DBL, SUP, IND, FAM…)
        │     └── Room (101, 102, 201…)
        │           └── HousekeepingStatus
        ├── RatePlan (BAR, NR, PKG, CORP…)
        │     ├── Restrictions (MinStay, CTA/CTD, CloseToArrival)
        │     ├── Inventory (allotment por fecha)
        │     └── Cancellation/Payment policy
        ├── Agency / Company (B2B)
        │     ├── Contract → RatePlan asociado
        │     └── Allotment / commission
        └── Channel (Booking.com, Expedia, Airbnb, direct…)

Guest (cardex) ───┬── Documents (DNI, passport, parte viajero)
                  ├── Preferences (cama, almohada, alergia)
                  └── Membership level (Aubergine VIP, etc.)

Reservation ──┬── ReservationGuests (primary + extras)
              ├── Room (asignación, puede ser null hasta checkin)
              ├── RoomType + RatePlan (siempre)
              ├── Group (opcional, link a master folio)
              ├── Source/Channel (de dónde viene)
              ├── Status (booked/checked_in/checked_out/cancelled/no_show)
              ├── Guarantee (CARD_ON_FILE, DEPOSIT, CORPORATE, NONE)
              │     ├── Stripe SetupIntent / PaymentMethod
              │     └── Status (PENDING, SECURED, FAILED, EXPIRED)
              └── Folio
                    ├── Charges (alojamiento, F&B, extras, taxes)
                    ├── Payments (cash, card, transfer, voucher)
                    └── Routing (qué cargo va a qué cuenta)

Group ──┬── ReservationBlock (rooming list)
        ├── MasterFolio (routing rules para cargos comunes)
        └── Cut-off date / pickup tracking
```

Conceptos sutiles que se nos olvidan:

- **Habitación vs tipo de habitación**: vendes el tipo (DBL), asignas la
  habitación (104). La asignación puede ser automática (auto-assign) o
  manual, y puede no ocurrir hasta el check-in.
- **Rate plan vs rate code vs tariff**: rate plan = paquete comercial
  (BAR, NR, PKG). Rate code = el código que el usuario teclea. Tariff =
  el precio numérico por fecha/tipo/plan. Un rate plan tiene N tariffs.
- **Reserva vs estancia**: una reserva puede tener varios "stays" si la
  habitación cambia mid-stay (room move).
- **Folio vs balance**: el folio es el conjunto de movimientos. El balance
  es la suma. Un folio puede estar abierto, cerrado, o "to be invoiced".
- **Garantía vs pago**: garantía = método para cobrar si pasa algo (no-show,
  daños). Pago = movimiento de dinero real. Pueden ser el mismo medio
  (tarjeta) o distintos (garantía CCG + pago en cash al checkout).

---

## 2. Estados y transiciones (state machines)

### 2.1 Reservation status

```
        ┌──────────────┐
   ─────▶   booked     │ creada, sin checkin
        └──────┬───────┘
               │ check-in (front desk)
               ▼
        ┌──────────────┐
        │  checked_in  │ huésped en hotel
        └──────┬───────┘
               │ check-out
               ▼
        ┌──────────────┐
        │ checked_out  │ finalizada
        └──────────────┘

        Caminos alternos:
        booked ──cancel──▶ cancelled
        booked ──no show─▶ no_show
        checked_in ──early dep─▶ checked_out (con penalty)
```

### 2.2 Guarantee status

```
PENDING ──set card/deposit──▶ SECURED
PENDING ──deadline exceeded─▶ EXPIRED
SECURED ──refund/release───▶ RELEASED
PENDING ──cobro falló──────▶ FAILED ──retry──▶ SECURED
```

### 2.3 Room (housekeeping)

```
DIRTY ──cleaned──▶ CLEAN ──inspected──▶ INSPECTED
DIRTY ──out of order──▶ OOO
CLEAN ──out of service──▶ OOS
```

### 2.4 Folio

```
OPEN ──charge/payment──▶ OPEN  (acumulando)
OPEN ──close_day──▶ CLOSED (factura emitida)
CLOSED ──refund──▶ ADJUSTED (con audit trail)
```

---

## 3. Flujos clave (end-to-end)

### 3.1 Walk-in → checkout

```
Walk-in mostrador
   │
   ▼
1. Buscar disponibilidad (RoomType + fechas + nº huéspedes)
2. Crear cardex (o buscar guest existente por DNI)
3. Crear reserva: status=booked, source=walk-in, garantía=CARD_ON_FILE pending
4. Capturar tarjeta (Stripe SetupIntent) → garantía SECURED
5. Asignar habitación específica (auto o manual)
6. Check-in: status=checked_in, room=DIRTY→OCCUPIED, parte viajero a SES
7. Durante estancia: cargos al folio (extras, F&B routed desde POS)
8. Check-out:
     - Liquidar folio (cobro con CCG ya capturada, o cash)
     - status=checked_out
     - room=OCCUPIED→DIRTY (a housekeeping)
     - factura final emitida, cerrar folio
9. Night audit (al cierre del día): posting room+tax al folio diario
```

### 3.2 Reserva OTA (Booking.com) → checkout

```
1. Channel manager recibe reserva → API → CRS
2. Crear reserva con source=booking.com, channel_reference=BC-12345
3. Garantía depende del rate plan (virtual card de Booking, CARD_ON_FILE,
   etc.). Si es Virtual Card → guardarla cifrada.
4. Día de llegada: ya está en /arrivals, falta asignar room + checkin
5. Resto idéntico al walk-in
6. Día siguiente al checkout: enviar manifest a OTA con noches reales
   (para que cuadre comisión)
```

### 3.3 Grupo corporate (50 habs, 3 noches)

```
1. Comercial firma contrato con empresa (rate code CORP-ACME, allotment 50)
2. Crear Group + Block: 50 reservas placeholder con company=ACME
3. Rooming list llega vía Excel/API → patchear cada reserva con nombres
4. Pickup tracking: cuántas del bloque están confirmadas
5. Cut-off date: día X libera lo no picked-up al inventario público
6. Master folio: routing "alojamiento+tax+desayuno → cuenta master ACME",
   "extras personales → cuenta huésped individual"
7. Check-in masivo (bulk operation, ya implementado en Phase 2)
8. Checkout: cuentas master se facturan a empresa, individuales al huésped
9. Commission al agente si aplica
```

### 3.4 Night audit (cierre diario)

```
A las 03:00 (configurable):
1. Verificar que no quedan check-ins/outs pendientes
2. Calcular ocupación, ADR, RevPAR del día
3. Posting automático: room rate + city tax → folio de cada huésped in-house
4. Generar reportes diarios (occupancy, source, market segment)
5. Trasladar saldos a contabilidad
6. Avanzar "fecha de operación" del hotel
7. Backups + envíos SES.HOSPEDAJES del día anterior
```

---

## 4. Conceptos comerciales avanzados (B2B)

| Concepto | Significado |
|---|---|
| **BAR (Best Available Rate)** | Tarifa pública del día, base para todo |
| **NR (Non-Refundable)** | BAR con descuento a cambio de no cancelar |
| **PKG (Package)** | BAR + extras (desayuno, parking, late checkout) |
| **CORP/NEG** | Tarifa negociada para empresa (descuento fijo o LRA) |
| **Allotment** | Bloque de habitaciones reservadas para agencia/empresa |
| **Cut-off date** | Día en que se libera el allotment no usado |
| **Commission** | % que se paga al agente/OTA por la reserva |
| **MinStay / CTA / CTD** | Restricciones por fecha (mínimo 2 noches, no llegadas, no salidas) |
| **LRA (Last Room Availability)** | Empresa puede reservar siempre, aún con hotel lleno |
| **Yield management** | Subir/bajar BAR según demanda predicha |
| **GDS (Global Distribution System)** | Amadeus, Sabre — distribución corporate |
| **Channel Manager** | Sincroniza inventario+precio con OTAs (SiteMinder, etc.) |
| **Booking engine** | Motor de reservas directas del hotel (website) |

---

## 5. Compliance España (must-have legal)

| Obligación | Qué exige | Estado Aubergine |
|---|---|---|
| **SES.HOSPEDAJES** | Envío diario de partes de viajero al MIR vía API | 🟡 Stub, falta productivo |
| **Libro registro de viajeros** | Conservar datos 3 años | ✅ En BD |
| **Factura simplificada/completa** | Numeración correlativa por serie, IVA desglosado | 🟡 Falta numerado oficial |
| **Veri\*factu / TicketBAI** | Facturación electrónica obligatoria (depende de comunidad) | ❌ Pendiente |
| **GDPR/RGPD** | Borrado a petición, datos mínimos, auditoría | 🟡 Tenemos audit, falta self-service |
| **Tasa turística (PIET, etc.)** | Cobro de tasa por noche y persona en algunas ciudades | ❌ No modelado |
| **IVA** | 10% alojamiento, 21% extras, exenciones | 🟡 Tipos básicos |

---

## 6. Estado actual de Aubergine (mayo 2026)

### ✅ Lo que YA funciona

- Multi-tenant con RLS, Keycloak SSO, audit log
- Crear/editar/cancelar reservas (individuales + grupos)
- Walk-ins instantáneos
- Asignación de habitación (auto + manual)
- Bulk: assign-rooms, check-in, check-out (grupos Phase 2)
- Pantallas: Reservas, Llegadas, Salidas, In-house (Iter A)
- Smart search + chips + filtros avanzados
- Cardex de huéspedes
- Folio: cargos y pagos manuales
- Night audit
- Garantía: tipos básicos + **Stripe SetupIntent (Fase 1) ✅ recién**
- Copilot (Claude Sonnet 4.6 + tool calling)
- Calendario de ocupación
- Dashboard básico
- Reportes (occupancy, ADR, mix de canal)
- ADR-023: deploy en Fly.io (cdg)

### 🟡 Lo parcial (funciona pero no rige todo)

- **Rate plans**: existen pero sin restricciones (MinStay, CTA/CTD), sin
  políticas de cancelación que se ejecuten solas, sin restricciones por
  fecha. Esto es el cuello de botella para Stripe Fase 2.
- **Folio**: cargos manuales sí, pero no hay routing automático (que el
  desayuno del paquete se cargue solo al checkin) ni splits master/extras.
- **B2B**: la columna "Agencia/Empresa" existe en la lista pero no hay
  entidad real. Vienen del campo libre de la reserva.
- **Housekeeping**: estados existen, no hay app móvil para camareras.
- **SES.HOSPEDAJES**: stub local, falta el endpoint productivo del MIR.
- **Facturación**: cobramos pero no emitimos factura legal con numerado.

### ❌ Lo que falta entero

- **Channel manager / Booking engine**: hoy todo se mete a mano.
- **Yield management**: precios fijos por temporada.
- **Voice HSK** (asistente voz para camareras).
- **Anomaly detection** (over-booking, no-show predictivo).
- **POS integration** (cafetería que postea automático al folio).
- **TicketBAI / Veri\*factu**.
- **Mobile app huésped** (check-in online, llave digital).
- **Group ops Phase 3+4**: master folio routing, pickup tracking, commission.

---

## 7. Mapa de dependencias para roadmap

Reglas: una capa no puede consolidarse si la inferior está coja.

```
Capa 5 — AI / Diferenciación
   Voice HSK · Anomaly · Revenue assistant · Smart copilot
        ▲
Capa 4 — Comercial avanzado
   Channel mgr · Booking engine · Yield · TicketBAI
        ▲
Capa 3 — Comercial básico
   Rate plans con restricciones · Políticas · B2B (agency/company entity)
   Folio routing · Master folio · Pickup tracking
        ▲
Capa 2 — Operación + compliance MÍNIMO viable
   SES.HOSPEDAJES productivo · Factura legal numerada · IVA correcto
   Housekeeping app · Stripe Fase 2 (cobro auto)
        ▲
Capa 1 — Núcleo PMS (DONE ✅)
   Multi-tenant · Reservas · Folio manual · Night audit · Cardex
   Front office · Calendario · Stripe Fase 1
```

**Conclusión sobre el orden**: Stripe Fase 2 depende de Rate plans maduros
(Capa 3) — por eso lo del usuario "esperar a tener rate codes" es correcto.
El path crítico inmediato es:

1. **Rate plans completos** (Capa 3): restricciones, políticas, B2B.
2. **SES.HOSPEDAJES productivo** (Capa 2): compliance bloqueante.
3. **Folio routing + facturación legal** (Capa 2/3): si vamos a cobrar.
4. **Luego Stripe Fase 2** automatizado con esas políticas.

---

## 8. Decisiones pendientes para próximos sprints

| Decisión | Opciones | Comentario |
|---|---|---|
| Channel manager | Construir propio vs integrar SiteMinder/Cubilis | Build = control + diferenciación AI; integrate = time-to-market |
| Booking engine | Construir vs integrar (TheBookingButton, etc.) | Mismo trade-off |
| TicketBAI | Hacer ahora vs esperar a expansión a Euskadi/Navarra | Solo obligatorio en esas CCAA |
| Voice HSK | Build con Whisper local vs API | Latencia vs cost |
| Mobile guest app | Native vs PWA | PWA = un solo codebase |

---

## 9. Cómo usar este documento

- **Antes de planear un sprint**: ¿en qué capa cae lo que vamos a hacer?
  ¿La capa inferior está sólida?
- **Cuando aparece una feature request**: ¿es de Capa 5 (AI) sin la 3 lista?
  Probablemente prematuro.
- **Tras cada release**: actualizar §6 (qué pasó a verde).
- **Cada vez que se decide un trade-off**: dejar un ADR (`docs/adr/`)
  para que no se olvide el porqué.

---

## 10. Glosario rápido

- **PMS** — Property Management System
- **CRS** — Central Reservation System
- **CRM** — Customer Relationship Management
- **POS** — Point Of Sale (cafetería, bar, spa…)
- **OTA** — Online Travel Agency (Booking, Expedia, Airbnb)
- **GDS** — Global Distribution System (Amadeus, Sabre)
- **ADR** — Average Daily Rate (ingresos rooms / rooms vendidas)
- **RevPAR** — Revenue Per Available Room (ingresos rooms / rooms disponibles)
- **MPI / RGI** — Market Penetration / Revenue Generation Index
- **HSK** — Housekeeping
- **F&B** — Food & Beverage
- **OOO / OOS** — Out Of Order / Out Of Service (habitación no vendible)
- **CCG** — Credit Card Guarantee
- **CCA** — Credit Card Authorization (preautorización con bloqueo)
- **NR** — Non-Refundable
- **BAR** — Best Available Rate
- **LRA** — Last Room Availability
- **MinStay / MaxStay** — Estancia mínima/máxima
- **CTA / CTD** — Close To Arrival / Close To Departure
- **Cardex / PMS-folio** — Ficha de huésped / cuenta del huésped
