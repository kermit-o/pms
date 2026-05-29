-- ----------------------------------------------------------------------------
-- Sprint 14 W2 — Verifactu (e-invoicing AEAT).
--
-- Tres tablas nuevas, todas RLS por tenant:
--   - invoices                 facturas inmutables emitidas (datos legales).
--   - invoice_submissions      cada intento de envío a AEAT (auditoría + retry).
--   - verifactu_certificates   metadata del .p12 cifrado en disco
--                              (/data/verifactu/<tenant_id>.p12.enc).
--
-- Ver ADR-030. AeatClient real está stub-only hasta certificación AEAT — esta
-- migración no asume nada sobre los endpoints reales.
-- ----------------------------------------------------------------------------

CREATE TYPE "invoice_status" AS ENUM (
  'DRAFT',
  'ISSUED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'VOIDED'
);

CREATE TYPE "invoice_submission_status" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'ACCEPTED',
  'REJECTED',
  'DEAD_LETTER'
);

-- ----------------------------------------------------------------------------
-- invoices
-- ----------------------------------------------------------------------------

CREATE TABLE "invoices" (
  "id"               UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID            NOT NULL,
  "property_id"      UUID            NOT NULL,
  "folio_id"         UUID,
  "series"           TEXT            NOT NULL DEFAULT 'A',
  "number"           INTEGER         NOT NULL,
  "invoice_date"     DATE            NOT NULL,
  "currency"         CHAR(3)         NOT NULL DEFAULT 'EUR',
  "subtotal"         DECIMAL(12, 2)  NOT NULL,
  "tax_amount"       DECIMAL(12, 2)  NOT NULL,
  "total_amount"     DECIMAL(12, 2)  NOT NULL,
  "status"           "invoice_status" NOT NULL DEFAULT 'DRAFT',
  "customer_name"    TEXT            NOT NULL,
  "customer_nif"     TEXT,
  "customer_address" TEXT,
  "lines"            JSONB           NOT NULL,
  "xml_payload"      TEXT,
  "xml_hash"         TEXT,
  "aeat_csv"         TEXT,
  "pdf_storage_key"  TEXT,
  "voided_at"        TIMESTAMPTZ(3),
  "voided_reason"    TEXT,
  "issued_at"        TIMESTAMPTZ(3),
  "created_at"       TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(3)  NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoices_tenant_id_series_number_key"
    UNIQUE ("tenant_id", "series", "number"),
  CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoices_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoices_folio_id_fkey" FOREIGN KEY ("folio_id")
    REFERENCES "folios" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "invoices_tenant_id_property_id_invoice_date_idx"
  ON "invoices" ("tenant_id", "property_id", "invoice_date");
CREATE INDEX "invoices_tenant_id_status_idx"
  ON "invoices" ("tenant_id", "status");

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "invoices_tenant_isolation"
  ON "invoices"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "invoices_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO pms_app;

-- ----------------------------------------------------------------------------
-- invoice_submissions
-- ----------------------------------------------------------------------------

CREATE TABLE "invoice_submissions" (
  "id"               UUID                       NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID                       NOT NULL,
  "invoice_id"       UUID                       NOT NULL,
  "attempt_number"   INTEGER                    NOT NULL,
  "status"           "invoice_submission_status" NOT NULL DEFAULT 'PENDING',
  "request_payload"  TEXT,
  "response_payload" TEXT,
  "response_code"    INTEGER,
  "aeat_csv"         TEXT,
  "error_message"    TEXT,
  "queued_at"        TIMESTAMPTZ(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at"       TIMESTAMPTZ(3),
  "completed_at"     TIMESTAMPTZ(3),
  "next_attempt_at"  TIMESTAMPTZ(3),
  CONSTRAINT "invoice_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_submissions_invoice_id_attempt_number_key"
    UNIQUE ("invoice_id", "attempt_number"),
  CONSTRAINT "invoice_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoice_submissions_invoice_id_fkey" FOREIGN KEY ("invoice_id")
    REFERENCES "invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "invoice_submissions_status_next_attempt_idx"
  ON "invoice_submissions" ("status", "next_attempt_at");
CREATE INDEX "invoice_submissions_tenant_id_invoice_id_idx"
  ON "invoice_submissions" ("tenant_id", "invoice_id");

ALTER TABLE "invoice_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_submissions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "invoice_submissions_tenant_isolation"
  ON "invoice_submissions"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "invoice_submissions_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "invoice_submissions"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "invoice_submissions" TO pms_app;

-- ----------------------------------------------------------------------------
-- verifactu_certificates
--
-- Una fila por tenant (UNIQUE). encrypted_blob_path apunta al .p12 cifrado
-- AES-256-GCM en disco. La clave maestra vive en VERIFACTU_MASTER_KEY (Fly
-- secret), nunca en DB. Ver ADR-030 §3.
-- ----------------------------------------------------------------------------

CREATE TABLE "verifactu_certificates" (
  "id"                  UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID            NOT NULL,
  "subject_cn"          TEXT            NOT NULL,
  "serial_number"       TEXT            NOT NULL,
  "fingerprint_sha256"  TEXT            NOT NULL,
  "not_before"          TIMESTAMPTZ(3)  NOT NULL,
  "not_after"           TIMESTAMPTZ(3)  NOT NULL,
  "encrypted_blob_path" TEXT            NOT NULL,
  "uploaded_by"         UUID,
  "uploaded_at"         TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"          TIMESTAMPTZ(3),
  "revoked_reason"      TEXT,
  "created_at"          TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(3)  NOT NULL,
  CONSTRAINT "verifactu_certificates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verifactu_certificates_tenant_id_key" UNIQUE ("tenant_id"),
  CONSTRAINT "verifactu_certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "verifactu_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verifactu_certificates" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "verifactu_certificates_tenant_isolation"
  ON "verifactu_certificates"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "verifactu_certificates_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "verifactu_certificates"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "verifactu_certificates" TO pms_app;
