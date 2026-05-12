-- ----------------------------------------------------------------------------
-- Fix audit triggers en tablas con primary key compuesta.
--
-- BUG (descubierto en piloto Berenjena, 2026-05-09): varias migraciones
-- añadían triggers de audit a tablas con PK compuesta (sin columna `id`).
-- La función log_audit() hace `v_record_id := NEW.id` pero esas tablas no
-- tienen ese campo → "ERROR: record \"new\" has no field \"id\"" en cada
-- INSERT, rompiendo:
--   * reservation_guests (PK reservation_id+guest_id) → creación de reserva
--   * business_day_states (PK property_id+business_date) → cierre nocturno
--
-- Fix: quitamos los triggers en tablas join. La audit log de N:N no es
-- operativamente crítica — los cambios reales se trazan en las tablas con
-- PK simple. Si en el futuro queremos auditar, hay que pasar log_audit() a
-- una variante que reciba el row_id como parámetro.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS reservation_guests_audit ON reservation_guests;
DROP TRIGGER IF EXISTS business_day_states_audit ON business_day_states;

