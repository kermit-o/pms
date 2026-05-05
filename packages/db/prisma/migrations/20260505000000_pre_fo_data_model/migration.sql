-- ============================================================================
-- PMS — Sprint 2 pre-work: modelo de datos canonico de Front Office.
--
-- Anade entidades centrales (RoomType, Room, Guest, RatePlan, Reservation,
-- ReservationGuest, Folio, FolioEntry) con sus enums.
-- Aplica el patron del Sprint 1: tenant_id + RLS FORCE + audit trigger.
--
-- Las entidades tienen el shape universal de la industria PMS. Los enums
-- y los campos `attributes` (jsonb) se pueden extender sin migracion tras
-- el feedback de hoteles boutique.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------

CREATE TYPE "room_status" AS ENUM ('CLEAN', 'DIRTY', 'INSPECTED', 'OUT_OF_ORDER', 'OUT_OF_SERVICE');
CREATE TYPE "document_type" AS ENUM ('DNI', 'NIE', 'PASSPORT', 'EU_ID', 'OTHER');
CREATE TYPE "reservation_status" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "reservation_source" AS ENUM ('DIRECT', 'WALK_IN', 'PHONE', 'EMAIL', 'BOOKING_COM', 'EXPEDIA', 'OTHER_OTA', 'CORPORATE', 'AGENT');
CREATE TYPE "folio_status" AS ENUM ('OPEN', 'CLOSED', 'SETTLED');
CREATE TYPE "folio_entry_type" AS ENUM ('CHARGE', 'PAYMENT', 'DISCOUNT', 'TAX', 'ADJUSTMENT');

-- ----------------------------------------------------------------------------
-- 2. Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE "room_types" (
  "id"               UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID            NOT NULL,
  "property_id"      UUID            NOT NULL,
  "code"             TEXT            NOT NULL,
  "name"             TEXT            NOT NULL,
  "description"      TEXT,
  "base_occupancy"   INTEGER         NOT NULL DEFAULT 2,
  "max_occupancy"    INTEGER         NOT NULL DEFAULT 2,
  "default_rate"     NUMERIC(12, 2)  NOT NULL DEFAULT 0,
  "default_currency" CHAR(3)         NOT NULL DEFAULT 'EUR',
  "attributes"       JSONB,
  "created_at"       TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(3)  NOT NULL,
  "deleted_at"       TIMESTAMPTZ(3),
  CONSTRAINT "room_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "room_types_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "room_types_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "room_types_tenant_id_property_id_code_key"
  ON "room_types" ("tenant_id", "property_id", "code");
CREATE INDEX "room_types_tenant_id_property_id_idx"
  ON "room_types" ("tenant_id", "property_id");

CREATE TABLE "rooms" (
  "id"                  UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID           NOT NULL,
  "property_id"         UUID           NOT NULL,
  "room_type_id"        UUID           NOT NULL,
  "number"              TEXT           NOT NULL,
  "floor"               TEXT,
  "status"              "room_status"  NOT NULL DEFAULT 'CLEAN',
  "is_out_of_order"     BOOLEAN        NOT NULL DEFAULT false,
  "out_of_order_reason" TEXT,
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(3) NOT NULL,
  "deleted_at"          TIMESTAMPTZ(3),
  CONSTRAINT "rooms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rooms_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rooms_room_type_id_fkey" FOREIGN KEY ("room_type_id")
    REFERENCES "room_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rooms_tenant_id_property_id_number_key"
  ON "rooms" ("tenant_id", "property_id", "number");
CREATE INDEX "rooms_tenant_id_property_id_idx"
  ON "rooms" ("tenant_id", "property_id");
CREATE INDEX "rooms_tenant_id_room_type_id_idx"
  ON "rooms" ("tenant_id", "room_type_id");

CREATE TABLE "guests" (
  "id"                       UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"                UUID            NOT NULL,
  "first_name"               TEXT            NOT NULL,
  "last_name"                TEXT            NOT NULL,
  "email"                    CITEXT,
  "phone"                    TEXT,
  "date_of_birth"            DATE,
  "document_type"            "document_type",
  "document_number"          TEXT,
  "document_issuing_country" CHAR(2),
  "document_expiry_date"     DATE,
  "nationality"              CHAR(2),
  "address_line1"            TEXT,
  "address_line2"            TEXT,
  "city"                     TEXT,
  "postal_code"              TEXT,
  "region"                   TEXT,
  "country"                  CHAR(2),
  "gdpr_consent"             BOOLEAN         NOT NULL DEFAULT false,
  "marketing_consent"        BOOLEAN         NOT NULL DEFAULT false,
  "notes"                    TEXT,
  "attributes"               JSONB,
  "created_at"               TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ(3)  NOT NULL,
  "deleted_at"               TIMESTAMPTZ(3),
  CONSTRAINT "guests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guests_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "guests_tenant_id_idx" ON "guests" ("tenant_id");
CREATE INDEX "guests_tenant_id_email_idx" ON "guests" ("tenant_id", "email");
CREATE INDEX "guests_tenant_id_document_type_document_number_idx"
  ON "guests" ("tenant_id", "document_type", "document_number");
CREATE INDEX "guests_tenant_id_last_name_first_name_idx"
  ON "guests" ("tenant_id", "last_name", "first_name");

CREATE TABLE "rate_plans" (
  "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID           NOT NULL,
  "property_id" UUID           NOT NULL,
  "code"        TEXT           NOT NULL,
  "name"        TEXT           NOT NULL,
  "description" TEXT,
  "is_public"   BOOLEAN        NOT NULL DEFAULT true,
  "currency"    CHAR(3)        NOT NULL DEFAULT 'EUR',
  "attributes"  JSONB,
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ(3) NOT NULL,
  "deleted_at"  TIMESTAMPTZ(3),
  CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rate_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rate_plans_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rate_plans_tenant_id_property_id_code_key"
  ON "rate_plans" ("tenant_id", "property_id", "code");
CREATE INDEX "rate_plans_tenant_id_property_id_idx"
  ON "rate_plans" ("tenant_id", "property_id");

CREATE TABLE "reservations" (
  "id"                  UUID                  NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID                  NOT NULL,
  "property_id"         UUID                  NOT NULL,
  "code"                TEXT                  NOT NULL,
  "status"              "reservation_status"  NOT NULL DEFAULT 'PENDING',
  "arrival_date"        DATE                  NOT NULL,
  "departure_date"      DATE                  NOT NULL,
  "adults"              INTEGER               NOT NULL DEFAULT 2,
  "children"            INTEGER               NOT NULL DEFAULT 0,
  "room_type_id"        UUID                  NOT NULL,
  "room_id"             UUID,
  "rate_plan_id"        UUID,
  "total_amount"        NUMERIC(12, 2)        NOT NULL DEFAULT 0,
  "currency"            CHAR(3)               NOT NULL DEFAULT 'EUR',
  "source"              "reservation_source"  NOT NULL DEFAULT 'DIRECT',
  "external_ref"        TEXT,
  "special_requests"    TEXT,
  "notes"               TEXT,
  "checked_in_at"       TIMESTAMPTZ(3),
  "checked_out_at"      TIMESTAMPTZ(3),
  "cancelled_at"        TIMESTAMPTZ(3),
  "cancellation_reason" TEXT,
  "created_at"          TIMESTAMPTZ(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(3)        NOT NULL,
  "deleted_at"          TIMESTAMPTZ(3),
  CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservations_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservations_room_type_id_fkey" FOREIGN KEY ("room_type_id")
    REFERENCES "room_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reservations_room_id_fkey" FOREIGN KEY ("room_id")
    REFERENCES "rooms" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reservations_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id")
    REFERENCES "rate_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reservations_dates_check" CHECK ("departure_date" > "arrival_date")
);
CREATE UNIQUE INDEX "reservations_tenant_id_code_key"
  ON "reservations" ("tenant_id", "code");
CREATE INDEX "reservations_tenant_id_property_id_arrival_date_idx"
  ON "reservations" ("tenant_id", "property_id", "arrival_date");
CREATE INDEX "reservations_tenant_id_property_id_departure_date_idx"
  ON "reservations" ("tenant_id", "property_id", "departure_date");
CREATE INDEX "reservations_tenant_id_property_id_status_idx"
  ON "reservations" ("tenant_id", "property_id", "status");
CREATE INDEX "reservations_tenant_id_room_id_idx"
  ON "reservations" ("tenant_id", "room_id");

CREATE TABLE "reservation_guests" (
  "reservation_id" UUID    NOT NULL,
  "guest_id"       UUID    NOT NULL,
  "tenant_id"      UUID    NOT NULL,
  "is_primary"     BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "reservation_guests_pkey" PRIMARY KEY ("reservation_id", "guest_id"),
  CONSTRAINT "reservation_guests_reservation_id_fkey" FOREIGN KEY ("reservation_id")
    REFERENCES "reservations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_guests_guest_id_fkey" FOREIGN KEY ("guest_id")
    REFERENCES "guests" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_guests_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "reservation_guests_tenant_id_guest_id_idx"
  ON "reservation_guests" ("tenant_id", "guest_id");

CREATE TABLE "folios" (
  "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"      UUID           NOT NULL,
  "reservation_id" UUID           NOT NULL,
  "status"         "folio_status" NOT NULL DEFAULT 'OPEN',
  "balance"        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  "currency"       CHAR(3)        NOT NULL DEFAULT 'EUR',
  "closed_at"      TIMESTAMPTZ(3),
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "folios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "folios_reservation_id_key" UNIQUE ("reservation_id"),
  CONSTRAINT "folios_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "folios_reservation_id_fkey" FOREIGN KEY ("reservation_id")
    REFERENCES "reservations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "folios_tenant_id_reservation_id_idx"
  ON "folios" ("tenant_id", "reservation_id");

CREATE TABLE "folio_entries" (
  "id"          UUID                NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID                NOT NULL,
  "folio_id"    UUID                NOT NULL,
  "type"        "folio_entry_type"  NOT NULL,
  "description" TEXT                NOT NULL,
  "amount"      NUMERIC(12, 2)      NOT NULL,
  "currency"    CHAR(3)             NOT NULL DEFAULT 'EUR',
  "posted_at"   TIMESTAMPTZ(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_by"   UUID,
  "attributes"  JSONB,
  CONSTRAINT "folio_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "folio_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "folio_entries_folio_id_fkey" FOREIGN KEY ("folio_id")
    REFERENCES "folios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "folio_entries_tenant_id_folio_id_idx"
  ON "folio_entries" ("tenant_id", "folio_id");
CREATE INDEX "folio_entries_tenant_id_posted_at_idx"
  ON "folio_entries" ("tenant_id", "posted_at");

-- ----------------------------------------------------------------------------
-- 3. Row-Level Security: ENABLE + FORCE + tenant_isolation policy
--    en cada tabla nueva.
-- ----------------------------------------------------------------------------

ALTER TABLE "room_types"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_types"         FORCE  ROW LEVEL SECURITY;
CREATE POLICY "room_types_tenant_isolation" ON "room_types"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "rooms"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms"              FORCE  ROW LEVEL SECURITY;
CREATE POLICY "rooms_tenant_isolation" ON "rooms"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "guests"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guests"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY "guests_tenant_isolation" ON "guests"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "rate_plans"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_plans"         FORCE  ROW LEVEL SECURITY;
CREATE POLICY "rate_plans_tenant_isolation" ON "rate_plans"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "reservations"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservations"       FORCE  ROW LEVEL SECURITY;
CREATE POLICY "reservations_tenant_isolation" ON "reservations"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "reservation_guests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_guests" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "reservation_guests_tenant_isolation" ON "reservation_guests"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "folios"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folios"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY "folios_tenant_isolation" ON "folios"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "folio_entries"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folio_entries"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY "folio_entries_tenant_isolation" ON "folio_entries"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- ----------------------------------------------------------------------------
-- 4. Audit triggers — reutiliza la funcion log_audit() del init.
-- ----------------------------------------------------------------------------

CREATE TRIGGER "room_types_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "room_types"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "rooms_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "rooms"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "guests_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "guests"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "rate_plans_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "rate_plans"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "reservations_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "reservation_guests_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "reservation_guests"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "folios_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "folios"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "folio_entries_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "folio_entries"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

-- ----------------------------------------------------------------------------
-- 5. GRANTs al rol pms_app (runtime de la API).
-- ----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "room_types"         TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "rooms"              TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "guests"             TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_plans"         TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "reservations"       TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "reservation_guests" TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "folios"             TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "folio_entries"      TO pms_app;
