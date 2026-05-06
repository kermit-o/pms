-- ----------------------------------------------------------------------------
-- Sprint 3 W1 — Night Audit orchestrator.
--
-- One run per (property, business_date). Steps are persisted individually so
-- a failed run can be reanudado from `last_failed_step`.
-- ----------------------------------------------------------------------------

CREATE TYPE "night_audit_run_status" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE "night_audit_step" AS ENUM (
  'POST_ROOM_CHARGES',
  'POST_TAXES',
  'POST_PACKAGES',
  'MARK_NO_SHOWS',
  'SNAPSHOT_REPORTS',
  'CLOSE_DAY'
);

CREATE TYPE "night_audit_step_status" AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED'
);

CREATE TABLE "night_audit_runs" (
  "id"                     UUID                    NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"              UUID                    NOT NULL,
  "property_id"            UUID                    NOT NULL,
  "business_date"          DATE                    NOT NULL,
  "status"                 "night_audit_run_status" NOT NULL DEFAULT 'PENDING',
  "started_at"             TIMESTAMPTZ(3),
  "completed_at"           TIMESTAMPTZ(3),
  "last_failed_step"       "night_audit_step",
  "last_error"             TEXT,
  "started_by_user_id"     UUID,
  "completed_by_user_id"   UUID,
  "totals"                 JSONB,
  "attributes"             JSONB,
  "created_at"             TIMESTAMPTZ(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMPTZ(3)          NOT NULL,
  CONSTRAINT "night_audit_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "night_audit_runs_property_id_business_date_key"
    UNIQUE ("property_id", "business_date"),
  CONSTRAINT "night_audit_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "night_audit_runs_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "night_audit_runs_tenant_id_property_id_idx"
  ON "night_audit_runs" ("tenant_id", "property_id");
CREATE INDEX "night_audit_runs_status_idx"
  ON "night_audit_runs" ("status");

CREATE TABLE "night_audit_run_steps" (
  "id"               UUID                       NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID                       NOT NULL,
  "run_id"           UUID                       NOT NULL,
  "step"             "night_audit_step"          NOT NULL,
  "status"           "night_audit_step_status"   NOT NULL DEFAULT 'PENDING',
  "started_at"       TIMESTAMPTZ(3),
  "completed_at"     TIMESTAMPTZ(3),
  "duration_ms"      INTEGER,
  "error"            TEXT,
  "result"           JSONB,
  "created_at"       TIMESTAMPTZ(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(3)             NOT NULL,
  CONSTRAINT "night_audit_run_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "night_audit_run_steps_run_id_step_key"
    UNIQUE ("run_id", "step"),
  CONSTRAINT "night_audit_run_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "night_audit_run_steps_run_id_fkey" FOREIGN KEY ("run_id")
    REFERENCES "night_audit_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "night_audit_run_steps_tenant_id_run_id_idx"
  ON "night_audit_run_steps" ("tenant_id", "run_id");

-- ----------------------------------------------------------------------------
-- RLS, audit, GRANTs
-- ----------------------------------------------------------------------------

ALTER TABLE "night_audit_runs"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "night_audit_runs"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY "night_audit_runs_tenant_isolation" ON "night_audit_runs"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "night_audit_run_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "night_audit_run_steps" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "night_audit_run_steps_tenant_isolation" ON "night_audit_run_steps"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "night_audit_runs_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "night_audit_runs"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "night_audit_run_steps_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "night_audit_run_steps"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "night_audit_runs"      TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "night_audit_run_steps" TO pms_app;
