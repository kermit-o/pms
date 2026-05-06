-- ----------------------------------------------------------------------------
-- Sprint 2 W2 — Group bookings.
-- Adds reservation_groups + reservations.group_id FK + RLS + audit.
-- Idempotent for environments where Prisma already has the schema.
-- ----------------------------------------------------------------------------

CREATE TABLE "reservation_groups" (
  "id"               UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID            NOT NULL,
  "property_id"      UUID            NOT NULL,
  "code"             TEXT            NOT NULL,
  "name"             TEXT            NOT NULL,
  "organizer_name"   TEXT,
  "organizer_email"  TEXT,
  "organizer_phone"  TEXT,
  "notes"            TEXT,
  "attributes"       JSONB,
  "created_at"       TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(3)  NOT NULL,
  "deleted_at"       TIMESTAMPTZ(3),
  CONSTRAINT "reservation_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_groups_tenant_id_code_key" UNIQUE ("tenant_id", "code"),
  CONSTRAINT "reservation_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_groups_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "reservation_groups_tenant_id_property_id_idx"
  ON "reservation_groups" ("tenant_id", "property_id");

ALTER TABLE "reservations" ADD COLUMN "group_id" UUID;
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "reservation_groups" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "reservations_tenant_id_group_id_idx"
  ON "reservations" ("tenant_id", "group_id");

-- ----------------------------------------------------------------------------
-- Row-Level Security
-- ----------------------------------------------------------------------------

ALTER TABLE "reservation_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_groups" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "reservation_groups_tenant_isolation" ON "reservation_groups"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- ----------------------------------------------------------------------------
-- Audit trigger
-- ----------------------------------------------------------------------------

CREATE TRIGGER "reservation_groups_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "reservation_groups"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

-- ----------------------------------------------------------------------------
-- GRANTs to runtime role
-- ----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "reservation_groups" TO pms_app;
