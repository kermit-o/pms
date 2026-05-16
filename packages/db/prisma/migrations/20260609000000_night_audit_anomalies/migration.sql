-- ----------------------------------------------------------------------------
-- Sprint 6 W2 — Night Audit anomaly detection.
--
-- Add DETECT_ANOMALIES step entre SNAPSHOT_REPORTS y CLOSE_DAY del pipeline NA.
-- Tabla night_audit_anomalies guarda cada señal con kind + severity + detalle
-- estructurado en JSONB. El supervisor del hotel decide si actuar — nada se
-- auto-corrige (ADR-020).
--
-- Reglas V1 (apps/api/src/night-audit/anomaly.service.ts):
--   DUPLICATE_CHARGE       critical
--   CASH_DRAWER_VARIANCE   high
--   DEEP_DISCOUNT          medium
--   CANCELLATION_SPREE     medium
--
-- RATE_OVERRIDE_ZSCORE (alta severidad) está documentado en el plan pero
-- deferido a V2 porque no hay baseline diario de BAR persistido.
--
-- See docs/SPRINT-6-PLAN.md §3.
-- ----------------------------------------------------------------------------

ALTER TYPE "night_audit_step" ADD VALUE IF NOT EXISTS 'DETECT_ANOMALIES';

CREATE TYPE "night_audit_anomaly_kind" AS ENUM (
  'DUPLICATE_CHARGE',
  'CASH_DRAWER_VARIANCE',
  'DEEP_DISCOUNT',
  'CANCELLATION_SPREE',
  'RATE_OVERRIDE'
);

CREATE TYPE "night_audit_anomaly_severity" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
);

CREATE TABLE "night_audit_anomalies" (
  "id"                 UUID                            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"          UUID                            NOT NULL,
  "property_id"        UUID                            NOT NULL,
  "run_id"             UUID                            NOT NULL,
  "business_date"      DATE                            NOT NULL,
  "kind"               "night_audit_anomaly_kind"      NOT NULL,
  "severity"           "night_audit_anomaly_severity"  NOT NULL,
  "details"            JSONB                            NOT NULL,
  "reviewed_at"        TIMESTAMPTZ(3),
  "reviewed_by_user_id" UUID,
  "review_notes"       TEXT,
  "created_at"         TIMESTAMPTZ(3)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "night_audit_anomalies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "night_audit_anomalies_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "night_audit_anomalies_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "night_audit_anomalies_run_id_fkey" FOREIGN KEY ("run_id")
    REFERENCES "night_audit_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "night_audit_anomalies_tenant_property_date_idx"
  ON "night_audit_anomalies" ("tenant_id", "property_id", "business_date");
CREATE INDEX "night_audit_anomalies_run_id_idx"
  ON "night_audit_anomalies" ("run_id");
CREATE INDEX "night_audit_anomalies_reviewed_at_idx"
  ON "night_audit_anomalies" ("reviewed_at")
  WHERE "reviewed_at" IS NULL;

-- ----------------------------------------------------------------------------
-- RLS, audit, GRANTs.
-- ----------------------------------------------------------------------------

ALTER TABLE "night_audit_anomalies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "night_audit_anomalies" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "night_audit_anomalies_tenant_isolation" ON "night_audit_anomalies"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "night_audit_anomalies_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "night_audit_anomalies"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE ON "night_audit_anomalies" TO pms_app;
