-- ----------------------------------------------------------------------------
-- Sprint 4 W3 — Lost & Found.
--
-- Camareras escanean / fotografian objetos olvidados. Una entrada por objeto.
-- Estado FOUND -> CLAIMED (entregado a huesped) | DISPOSED (descartado tras
-- ventana legal). Las fotos viven inline (base64) durante MVP; en V2 pasaran
-- a S3 con URLs firmadas — la columna se mantiene compatible.
-- ----------------------------------------------------------------------------

CREATE TYPE "lost_found_status" AS ENUM (
  'FOUND',
  'CLAIMED',
  'DISPOSED'
);

CREATE TABLE "lost_found_items" (
  "id"                 UUID                NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"          UUID                NOT NULL,
  "property_id"        UUID                NOT NULL,
  "room_id"            UUID,
  "found_by_user_id"   UUID                NOT NULL,
  "found_at"           TIMESTAMPTZ(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description"        TEXT                NOT NULL,
  "photo_base64"       TEXT,
  "status"             "lost_found_status" NOT NULL DEFAULT 'FOUND',
  "claimed_by_guest_id" UUID,
  "claimed_at"         TIMESTAMPTZ(3),
  "claimed_notes"      TEXT,
  "disposed_at"        TIMESTAMPTZ(3),
  "disposed_notes"     TEXT,
  "notes"              TEXT,
  "created_at"         TIMESTAMPTZ(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(3)      NOT NULL,
  "deleted_at"         TIMESTAMPTZ(3),
  CONSTRAINT "lost_found_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lost_found_items_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lost_found_items_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lost_found_items_room_id_fkey" FOREIGN KEY ("room_id")
    REFERENCES "rooms" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "lost_found_items_claimed_by_guest_id_fkey" FOREIGN KEY ("claimed_by_guest_id")
    REFERENCES "guests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "lost_found_items_tenant_id_property_id_status_idx"
  ON "lost_found_items" ("tenant_id", "property_id", "status");
CREATE INDEX "lost_found_items_tenant_id_property_id_found_at_idx"
  ON "lost_found_items" ("tenant_id", "property_id", "found_at");
CREATE INDEX "lost_found_items_tenant_id_room_id_idx"
  ON "lost_found_items" ("tenant_id", "room_id");

ALTER TABLE "lost_found_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lost_found_items" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "lost_found_items_tenant_isolation" ON "lost_found_items"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "lost_found_items_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "lost_found_items"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "lost_found_items" TO pms_app;
