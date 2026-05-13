-- ----------------------------------------------------------------------------
-- Corte A: garantía de reserva + política de cancelación.
--
-- Industry-standard: cada reserva debe tener un guaranteeType. Sin él, la
-- reserva es de papel y cualquier hotel real la rechaza. Esta migración añade
-- el modelo. La tokenización real con Stripe llega en Corte B.
--
-- Enums:
--   GuaranteeType: NONE (walk-in pagado en mostrador) | CARD_ON_FILE |
--                  DEPOSIT | CORPORATE | HOTEL_GUARANTEE (VIP, sin garantia)
--   GuaranteeStatus: PENDING | SECURED | EXPIRED | FAILED | RELEASED
--
-- Tabla cancellation_policies por tenant+property con politica simple
-- (horas antes de llegada + penalty pct). Seed default: 24h, 100%.
-- ----------------------------------------------------------------------------

CREATE TYPE "guarantee_type" AS ENUM (
  'NONE',
  'CARD_ON_FILE',
  'DEPOSIT',
  'CORPORATE',
  'HOTEL_GUARANTEE'
);

CREATE TYPE "guarantee_status" AS ENUM (
  'PENDING',
  'SECURED',
  'EXPIRED',
  'FAILED',
  'RELEASED'
);

CREATE TABLE "cancellation_policies" (
  "id"                   UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            UUID            NOT NULL,
  "property_id"          UUID            NOT NULL,
  "code"                 TEXT            NOT NULL,
  "name"                 TEXT            NOT NULL,
  "hours_before_arrival" INTEGER         NOT NULL DEFAULT 24,
  "penalty_pct"          NUMERIC(5, 2)   NOT NULL DEFAULT 100,
  "penalty_min_amount"   NUMERIC(12, 2),
  "currency"             CHAR(3)         NOT NULL DEFAULT 'EUR',
  "created_at"           TIMESTAMPTZ(3)  NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ(3)  NOT NULL DEFAULT NOW(),
  "deleted_at"           TIMESTAMPTZ(3),
  CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cancellation_policies_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE,
  CONSTRAINT "cancellation_policies_property_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "cancellation_policies_tenant_property_code_key"
  ON "cancellation_policies" ("tenant_id", "property_id", "code");

CREATE INDEX "cancellation_policies_tenant_property_idx"
  ON "cancellation_policies" ("tenant_id", "property_id");

ALTER TABLE "cancellation_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cancellation_policies" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "cancellation_policies_tenant_isolation" ON "cancellation_policies"
  USING      ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "cancellation_policies" TO pms_app;

-- ----------------------------------------------------------------------------
-- Reservation: añadir campos de garantía.
-- ----------------------------------------------------------------------------

ALTER TABLE "reservations"
  ADD COLUMN "guarantee_type"        "guarantee_type"   NOT NULL DEFAULT 'NONE',
  ADD COLUMN "guarantee_status"      "guarantee_status" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "guarantee_amount"      NUMERIC(12, 2),
  ADD COLUMN "guarantee_reference"   TEXT,
  ADD COLUMN "guarantee_deadline"    TIMESTAMPTZ(3),
  ADD COLUMN "guarantee_secured_at"  TIMESTAMPTZ(3),
  ADD COLUMN "cancellation_policy_id" UUID,
  ADD CONSTRAINT "reservations_cancellation_policy_fkey"
    FOREIGN KEY ("cancellation_policy_id")
    REFERENCES "cancellation_policies" ("id") ON DELETE SET NULL;

CREATE INDEX "reservations_tenant_guarantee_status_idx"
  ON "reservations" ("tenant_id", "guarantee_status");

-- Backfill: reservas existentes (las del piloto manual) quedan en
-- guarantee_type=NONE / status=PENDING. El operador puede actualizarlas
-- via UI cuando confirme la garantía recibida.
