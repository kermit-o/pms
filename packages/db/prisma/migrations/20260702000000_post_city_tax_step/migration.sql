-- RFC-001 §3.3 — añade POST_CITY_TAX al enum night_audit_step.
-- El nuevo step (PostCityTaxStep) postea city tax tras PostRoomCharges
-- para cada reserva CHECKED_IN bajo CityTaxRule activa.

ALTER TYPE "night_audit_step" ADD VALUE 'POST_CITY_TAX' AFTER 'POST_PACKAGES';
