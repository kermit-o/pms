-- ----------------------------------------------------------------------------
-- Sprint 2 W5 — Business-day state + locking.
--
-- Each (property, business_date) row tracks whether operations on that
-- business day are open or closed. Reservation/folio mutations consult this
-- table to decide whether to allow writes that touch a closed day.
-- ----------------------------------------------------------------------------

CREATE TYPE "business_day_status" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "business_day_states" (
  "tenant_id"        UUID                NOT NULL,
  "property_id"      UUID                NOT NULL,
  "business_date"    DATE                NOT NULL,
  "status"           "business_day_status" NOT NULL DEFAULT 'OPEN',
  "closed_at"        TIMESTAMPTZ(3),
  "closed_by_user_id" UUID,
  "reopened_at"      TIMESTAMPTZ(3),
  "reopened_reason"  TEXT,
  "created_at"       TIMESTAMPTZ(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(3)      NOT NULL,
  CONSTRAINT "business_day_states_pkey" PRIMARY KEY ("property_id", "business_date"),
  CONSTRAINT "business_day_states_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_day_states_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "business_day_states_tenant_id_property_id_idx"
  ON "business_day_states" ("tenant_id", "property_id");

-- ----------------------------------------------------------------------------
-- RLS, audit, GRANTs
-- ----------------------------------------------------------------------------

ALTER TABLE "business_day_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_day_states" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "business_day_states_tenant_isolation" ON "business_day_states"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "business_day_states_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "business_day_states"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "business_day_states" TO pms_app;
