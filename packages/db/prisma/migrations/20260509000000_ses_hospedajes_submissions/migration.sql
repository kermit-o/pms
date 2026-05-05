-- ----------------------------------------------------------------------------
-- Sprint 2 W6 — SES.HOSPEDAJES (Guardia Civil) submission tracking.
--
-- One row per (property, business_date). On submit we render the XML, store
-- the payload + signature, and try to deliver to the configured endpoint.
-- Failures are recorded with retry_count and last_error; retries are scheduled
-- by the worker (out of band).
-- ----------------------------------------------------------------------------

CREATE TYPE "ses_submission_status" AS ENUM (
  'QUEUED',
  'SENT',
  'FAILED',
  'DEAD_LETTER'
);

CREATE TABLE "ses_hospedajes_submissions" (
  "id"              UUID                   NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"       UUID                   NOT NULL,
  "property_id"     UUID                   NOT NULL,
  "business_date"   DATE                   NOT NULL,
  "status"          "ses_submission_status" NOT NULL DEFAULT 'QUEUED',
  "xml_payload"     TEXT,
  "xml_signature"   TEXT,
  "submitted_at"    TIMESTAMPTZ(3),
  "response_code"   INTEGER,
  "response_body"   TEXT,
  "retry_count"     INTEGER                NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "next_attempt_at" TIMESTAMPTZ(3),
  "created_at"      TIMESTAMPTZ(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(3)         NOT NULL,
  CONSTRAINT "ses_hospedajes_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ses_hospedajes_submissions_property_id_business_date_key"
    UNIQUE ("property_id", "business_date"),
  CONSTRAINT "ses_hospedajes_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ses_hospedajes_submissions_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ses_hospedajes_submissions_tenant_id_property_id_idx"
  ON "ses_hospedajes_submissions" ("tenant_id", "property_id");
CREATE INDEX "ses_hospedajes_submissions_status_next_attempt_idx"
  ON "ses_hospedajes_submissions" ("status", "next_attempt_at");

-- ----------------------------------------------------------------------------
-- RLS, audit, GRANTs
-- ----------------------------------------------------------------------------

ALTER TABLE "ses_hospedajes_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ses_hospedajes_submissions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "ses_hospedajes_submissions_tenant_isolation"
  ON "ses_hospedajes_submissions"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "ses_hospedajes_submissions_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "ses_hospedajes_submissions"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "ses_hospedajes_submissions" TO pms_app;
