# Sprint 2 Pre-work — Modelo de datos canónico de Front Office

> **Objetivo:** dejar el schema y la migración listos para que cuando lleguen
> los feedbacks de hoteles, podamos saltar directos a workflows en lugar de
> diseñar entidades.
>
> **No es Sprint 2 funcional.** Aquí no hay controllers, services ni features.
> Sólo el modelo de datos canónico que cualquier PMS hotelero necesita.

Ver [ADR-018](../PROJECT.md#adr-018--2026-05-05--modelo-de-datos-pre-work-antes-de-hablar-con-hoteles) para la justificación.

## Qué incluye

### Entidades nuevas

| Entidad            | Propósito                                  | Campos clave                                                           |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------------- |
| `RoomType`         | Categorización (Standard, Deluxe, Suite…)  | code, baseOccupancy, maxOccupancy, defaultRate, **attributes jsonb**   |
| `Room`             | Inventario físico                          | number, floor, status (enum), is_out_of_order                          |
| `Guest`            | Cardex de huéspedes — compliance ES + GDPR | first/last name, document_type (DNI/NIE/passport/EU_ID), gdpr_consent  |
| `RatePlan`         | Plan tarifario (BAR, NRF, AGENCY…)         | code, isPublic, currency, **attributes jsonb** (restricciones)         |
| `Reservation`      | Reserva — entidad central de FO            | code, status, arrival/departure, room_type_id, room_id (null hasta CI) |
| `ReservationGuest` | M2M reserva ↔ huésped (familias, grupos)   | is_primary                                                             |
| `Folio`            | Cuenta financiera (1:1 con reserva)        | status, balance, currency                                              |
| `FolioEntry`       | Línea append-only del folio                | type (CHARGE/PAYMENT/DISCOUNT/TAX/ADJUSTMENT), amount, posted_at       |

### Enums

`room_status`, `document_type`, `reservation_status`, `reservation_source`, `folio_status`, `folio_entry_type`. Conservadores — se extienden con `ALTER TYPE` cuando aparezca un valor nuevo.

### Aspectos no funcionales aplicados a las nuevas tablas

- **RLS `ENABLE` + `FORCE`** + policy `tenant_id = app_current_tenant_id()` en TODAS.
- **Audit triggers** (`AFTER INSERT/UPDATE/DELETE`) que llaman a `log_audit()` — registro inmutable en `audit_log`.
- **`tenant_id` indexado** en cada tabla y formando parte de los unique constraints donde aplica.
- **Soft delete** (`deleted_at`) en entidades de dominio (per ADR-010); `Folio` y `FolioEntry` no tienen soft-delete porque son append-only por diseño.
- **GRANTs** explícitos a `pms_app` (rol runtime, sin BYPASSRLS).
- **CHECK constraint** `departure_date > arrival_date` en `reservations`.

## Qué NO incluye (espera al feedback de hoteles)

- **Controllers / services / DTOs.** El contrato de API (qué endpoints, qué body shapes) depende de los workflows reales del hotel.
- **Eventos del dominio** (`reservation.created`, `guest.checked_in`, `folio.charge_posted`…). Mismo motivo.
- **Tools MCP** específicas de FO (`create_reservation`, `check_in_guest`, etc.).
- **`RatePlanDayRate`** o tabla de tarifas por fecha. Hay 3 modelos comunes (rate by day, rate by season, rate by LOS) — esperamos a ver cuál usan los hoteles.
- **Validaciones de overbooking** y disponibilidad. Necesita workflows.
- **Group bookings** específicos. Algunos hoteles los manejan como una sola reserva con N habitaciones, otros como N reservas linkadas. Esperamos.
- **SES.HOSPEDAJES integration** (parser/sender). El schema lo soporta (`Guest.documentType`/`documentNumber`), pero el servicio que envía a SES viene en Sprint 2 funcional.

## Cómo aplicar este pre-work

```bash
# Tras pull de la rama
pnpm install
pnpm --filter @pms/db generate

# Si tu DB ya está con la migración inicial:
pnpm --filter @pms/db migrate:deploy

# Si quieres reset limpio:
pnpm --filter @pms/db migrate:reset
pnpm --filter @pms/db seed
```

## Inspección

```bash
docker exec -it pms-postgres psql -U pms -d pms -c "\dt"
# Ahora deberías ver: tenants, users, properties, audit_log,
# room_types, rooms, guests, rate_plans, reservations,
# reservation_guests, folios, folio_entries

docker exec -it pms-postgres psql -U pms -d pms -c "SELECT code, name, default_rate FROM room_types;"
docker exec -it pms-postgres psql -U pms -d pms -c "SELECT number, floor, status FROM rooms ORDER BY number;"
```

## Plan al recibir feedback de hoteles

1. Revisar `docs/HOTEL-DISCOVERY.md` — sintetizar pain points y features pedidas.
2. Decidir qué workflows entran en Sprint 2 (probablemente: walk-in fast path, group bookings, alguna integración compliance, …).
3. Crear nueva rama `claude/sprint-2-mvp-fo` desde `main` (con este pre-work mergeado).
4. **Diseñar contracts**: DTOs de entrada/salida, eventos del catálogo, tools MCP.
5. Implementar controllers/services + tests + tools MCP en orden lógico:
   1. Reservas CRUD (crear / modificar / cancelar).
   2. Asignación de habitación + check-in.
   3. Folio (cargos manuales + pagos).
   4. Check-out.
   5. Cardex / SES.HOSPEDAJES export.
6. Cuando sale el primer endpoint funcional, publicar evento al eventbus + tool MCP.
