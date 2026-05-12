-- ----------------------------------------------------------------------------
-- Fix audit trigger en business_day_states.
--
-- BUG (descubierto en piloto Berenjena, 2026-05-12): la migracion
-- 20260508000000_business_day_state agrego `business_day_states_audit` que
-- ejecuta log_audit(). Esa funcion hace `v_record_id := NEW.id` pero
-- business_day_states tiene PK compuesta (property_id, business_date) sin
-- columna `id` → "ERROR: record \"new\" has no field \"id\"" al hacer
-- INSERT, bloqueando /business-day/close (night audit).
--
-- Mismo patron que la migracion 20260604000000 que arreglo
-- reservation_guests. Aplicamos el mismo fix: drop del trigger. La audit
-- log no es operativamente critica para business_day_states; el rastro
-- real lo lleva NightAuditRun + NightAuditRunStep que si tienen PK simple.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS business_day_states_audit ON business_day_states;
