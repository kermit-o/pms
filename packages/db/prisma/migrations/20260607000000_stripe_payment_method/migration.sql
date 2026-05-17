-- ----------------------------------------------------------------------------
-- Corte B Stripe: tokenizacion real de tarjeta para guaranteeType=CARD_ON_FILE.
--
-- Flow:
--   1. Operador click 'Capturar tarjeta' en la reserva.
--   2. API crea SetupIntent en Stripe, devuelve client_secret.
--   3. Web-fo renderiza Stripe Elements con ese client_secret.
--   4. Huesped/operador rellena tarjeta -> Stripe la tokeniza.
--   5. Webhook setup_intent.succeeded -> reservation.guaranteeStatus = SECURED
--      + se guarda payment_method_id + ultimos 4 + brand.
--
-- Solo se guardan ultimos 4 + brand + exp para mostrar al operador. El PAN
-- completo nunca toca nuestros servidores (Stripe Connect PCI-compliant).
-- ----------------------------------------------------------------------------

ALTER TABLE "reservations"
  ADD COLUMN "stripe_customer_id"       TEXT,
  ADD COLUMN "stripe_setup_intent_id"   TEXT,
  ADD COLUMN "stripe_payment_method_id" TEXT,
  ADD COLUMN "stripe_card_brand"        TEXT,
  ADD COLUMN "stripe_card_last4"        CHAR(4),
  ADD COLUMN "stripe_card_exp_month"    SMALLINT,
  ADD COLUMN "stripe_card_exp_year"     SMALLINT;

CREATE INDEX "reservations_stripe_setup_intent_idx"
  ON "reservations" ("stripe_setup_intent_id");
