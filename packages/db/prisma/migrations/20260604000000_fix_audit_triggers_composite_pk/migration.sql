-- ----------------------------------------------------------------------------
-- Fix audit triggers en tablas con primary key compuesta.
--
-- BUG (descubierto en piloto Berenjena, 2026-05-09): la migración
-- 20260505000000_pre_fo_data_model añadía `reservation_guests_audit` que
-- ejecuta log_audit(). Esa función hace `v_record_id := NEW.id` pero
-- reservation_guests tiene PK compuesta (reservation_id, guest_id) sin
-- columna `id` → "ERROR: record \"new\" has no field \"id\"" en cada
-- INSERT, rompiendo la creación de reservas.
--
-- Fix: simplemente quitamos el trigger de las tablas afectadas. La audit
-- log de tablas-join (relación N:N) no es operativamente crítica — los
-- cambios reales se trazan en las tablas con PK simple (reservations,
-- guests). Si en el futuro queremos auditar reservation_guests, hay que
-- pasar log_audit() a una variante que reciba el row_id como parámetro.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS reservation_guests_audit ON reservation_guests;
