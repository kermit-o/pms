-- ----------------------------------------------------------------------------
-- Sprint 3 W1 — Night Audit immutable snapshots.
--
-- One row per (property, business_date, report_type). Snapshots are written
-- by the SNAPSHOT_REPORTS step and are append-only — re-running the audit
-- recomputes them in place via the unique constraint + UPSERT.
-- ----------------------------------------------------------------------------

CREATE TYPE "night_audit_report_type" AS ENUM (
  'MANAGER',
  'IN_HOUSE',
  'ARRIVALS_DEPARTURES',
  'REVENUE',
  'TAX'
);

CREATE TABLE "night_audit_snapshots" (
  "id"            UUID                      NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"     UUID                      NOT NULL,
  "property_id"   UUID                      NOT NULL,
  "business_date" DATE                      NOT NULL,
  "report_type"   "night_audit_report_type"  NOT NULL,
  "payload"       JSONB                     NOT NULL,
  "generated_at"  TIMESTAMPTZ(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "run_id"        UUID,
  CONSTRAINT "night_audit_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "night_audit_snapshots_property_id_business_date_report_type_key"
    UNIQUE ("property_id", "business_date", "report_type"),
  CONSTRAINT "night_audit_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "night_audit_snapshots_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "night_audit_snapshots_run_id_fkey" FOREIGN KEY ("run_id")
    REFERENCES "night_audit_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "night_audit_snapshots_tenant_id_property_id_idx"
  ON "night_audit_snapshots" ("tenant_id", "property_id");

ALTER TABLE "night_audit_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "night_audit_snapshots" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "night_audit_snapshots_tenant_isolation" ON "night_audit_snapshots"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "night_audit_snapshots_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "night_audit_snapshots"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "night_audit_snapshots" TO pms_app;
