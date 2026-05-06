-- ----------------------------------------------------------------------------
-- Sprint 3 W5 — Cash drawer reconciliation gating the Night Audit close.
--
-- One row per (property, business_date). expected_amount is computed from
-- the sum of folio_entries.PAYMENT with attributes.paymentMethod = 'CASH'
-- on the business_date; counted_amount is what the night auditor counts.
-- ----------------------------------------------------------------------------

CREATE TABLE "cash_drawer_reconciliations" (
  "id"                 UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"          UUID            NOT NULL,
  "property_id"        UUID            NOT NULL,
  "business_date"      DATE            NOT NULL,
  "currency"           CHAR(3)         NOT NULL DEFAULT 'EUR',
  "expected_amount"    NUMERIC(12, 2)  NOT NULL DEFAULT 0,
  "counted_amount"     NUMERIC(12, 2)  NOT NULL DEFAULT 0,
  "discrepancy"        NUMERIC(12, 2)  NOT NULL DEFAULT 0,
  "tolerance_cents"    INTEGER         NOT NULL DEFAULT 0,
  "counted_by_user_id" UUID,
  "notes"              TEXT,
  "created_at"         TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(3)  NOT NULL,
  CONSTRAINT "cash_drawer_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_drawer_reconciliations_property_id_business_date_key"
    UNIQUE ("property_id", "business_date"),
  CONSTRAINT "cash_drawer_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cash_drawer_reconciliations_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cash_drawer_reconciliations_tenant_id_property_id_idx"
  ON "cash_drawer_reconciliations" ("tenant_id", "property_id");

ALTER TABLE "cash_drawer_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_drawer_reconciliations" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "cash_drawer_reconciliations_tenant_isolation"
  ON "cash_drawer_reconciliations"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "cash_drawer_reconciliations_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "cash_drawer_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_drawer_reconciliations" TO pms_app;
