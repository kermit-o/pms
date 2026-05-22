-- Sprint 14 W1 — Stripe Billing al tenant (el SaaS cobra al hotel).
--
-- Hoy cobramos al huésped vía Stripe (Sprint 11/12 W3). Pero al hotel
-- no le cobramos nada por usar Aubergine. Esta migración añade las
-- columnas mínimas para suscripción SaaS al tenant.
--
-- Decisiones de diseño:
--  - `stripe_customer_id` y `stripe_subscription_id` separadas del
--    `Reservation.stripeCustomerId` del huésped. El tenant tiene su
--    propio Customer en Stripe (otra cuenta lógica).
--  - `subscription_status` como text + check para añadir estados sin
--    migración. Mapea 1:1 a los estados de Stripe.
--  - `trial_ends_at` por separado de `current_period_end` para poder
--    distinguir "trial activo" de "suscripción activa cobrando".
--  - Forward-only, NULLABLE — los tenants existentes siguen
--    funcionando sin suscripción (banner pidiéndoles activar).

ALTER TABLE "tenants"
  ADD COLUMN "stripe_customer_id" text,
  ADD COLUMN "stripe_subscription_id" text,
  ADD COLUMN "subscription_status" text,
  ADD COLUMN "current_period_end" timestamp(3),
  ADD COLUMN "trial_ends_at" timestamp(3);

-- Stripe garantiza unicidad de customer y subscription IDs. Índice
-- único permite búsqueda O(1) desde el webhook handler que sólo trae
-- esos IDs y necesita resolver el tenant.
CREATE UNIQUE INDEX "tenants_stripe_customer_id_key"
  ON "tenants"("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;

CREATE UNIQUE INDEX "tenants_stripe_subscription_id_key"
  ON "tenants"("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_subscription_status_check"
  CHECK (
    "subscription_status" IS NULL OR
    "subscription_status" IN (
      'trialing', 'active', 'past_due', 'canceled',
      'unpaid', 'incomplete', 'incomplete_expired', 'paused'
    )
  );
