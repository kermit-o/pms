-- Sprint 13 W1 — Rate plans formales: tarifas no reembolsables.
--
-- Añade dos columnas tipadas a rate_plans para soportar tarifas
-- "no reembolsable" con descuento sobre el rate base:
--
--  - non_refundable: si true, la reserva no admite cancelación gratuita
--    desde el IBE y exige paymentMode=charge en createReservation.
--  - discount_pct: porcentaje (0-100) sobre RoomType.defaultRate; null
--    significa "usar la tarifa base sin modificar".
--
-- Forward-only. Default false/NULL → no afecta a planes existentes.

ALTER TABLE "rate_plans"
  ADD COLUMN "non_refundable" boolean NOT NULL DEFAULT false,
  ADD COLUMN "discount_pct" numeric(5, 2);
