-- ============================================================================
-- PMS — Initial migration
-- Creates tenants, users, properties, audit_log + RLS policies + audit triggers.
--
-- Architecture:
--   - Owner role (pms): runs this migration, owns tables, BYPASSRLS as superuser.
--   - App role (pms_app): used by API at runtime. RLS policies apply to it.
--
-- Notes:
--   - tenants table has NO RLS (admin-level table; exposure controlled by API).
--   - users, properties: ENABLE + FORCE RLS, full tenant isolation.
--   - audit_log: ENABLE RLS (no FORCE) + SELECT-only policy for app.
--     INSERT only via SECURITY DEFINER trigger (bypasses RLS as owner).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------

CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'TRIAL', 'SUSPENDED');
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');
CREATE TYPE "audit_operation" AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

CREATE TABLE "tenants" (
  "id"         UUID            NOT NULL DEFAULT gen_random_uuid(),
  "slug"       TEXT            NOT NULL,
  "name"       TEXT            NOT NULL,
  "status"     "tenant_status" NOT NULL DEFAULT 'TRIAL',
  "created_at" TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3)  NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" ("slug");

CREATE TABLE "users" (
  "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID           NOT NULL,
  "email"       CITEXT         NOT NULL,
  "external_id" TEXT,
  "full_name"   TEXT,
  "status"      "user_status"  NOT NULL DEFAULT 'INVITED',
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ(3) NOT NULL,
  "deleted_at"  TIMESTAMPTZ(3),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "users_tenant_id_email_key"       ON "users" ("tenant_id", "email");
CREATE UNIQUE INDEX "users_tenant_id_external_id_key" ON "users" ("tenant_id", "external_id");
CREATE INDEX        "users_tenant_id_idx"             ON "users" ("tenant_id");

CREATE TABLE "properties" (
  "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  UUID           NOT NULL,
  "code"       TEXT           NOT NULL,
  "name"       TEXT           NOT NULL,
  "timezone"   TEXT           NOT NULL DEFAULT 'Europe/Madrid',
  "currency"   TEXT           NOT NULL DEFAULT 'EUR',
  "locale"     TEXT           NOT NULL DEFAULT 'es-ES',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "properties_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "properties_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "properties_tenant_id_code_key" ON "properties" ("tenant_id", "code");
CREATE INDEX        "properties_tenant_id_idx"      ON "properties" ("tenant_id");

CREATE TABLE "audit_log" (
  "id"             UUID              NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"      UUID              NOT NULL,
  "table_name"     TEXT              NOT NULL,
  "record_id"      UUID              NOT NULL,
  "operation"      "audit_operation" NOT NULL,
  "actor_id"       UUID,
  "correlation_id" TEXT,
  "old_data"       JSONB,
  "new_data"       JSONB,
  "changed_at"     TIMESTAMPTZ(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_log_tenant_id_table_name_record_id_idx"
  ON "audit_log" ("tenant_id", "table_name", "record_id");
CREATE INDEX "audit_log_tenant_id_changed_at_idx"
  ON "audit_log" ("tenant_id", "changed_at");

-- ----------------------------------------------------------------------------
-- 3. Helper functions: read tenant_id / actor_id / correlation_id from session
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_current_actor_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_current_correlation_id() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.correlation_id', true), '')
$$;

-- ----------------------------------------------------------------------------
-- 4. Row-Level Security policies
-- ----------------------------------------------------------------------------

-- Users
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "users_tenant_isolation" ON "users"
  USING      ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Properties
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "properties_tenant_isolation" ON "properties"
  USING      ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Audit log: SELECT-only for app, INSERT only via trigger
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
-- NOT forced: owner (and SECURITY DEFINER trigger function) bypasses RLS to insert.

CREATE POLICY "audit_log_tenant_isolation_select" ON "audit_log"
  FOR SELECT USING ("tenant_id" = app_current_tenant_id());

-- No INSERT/UPDATE/DELETE policies => denied for app role.

-- ----------------------------------------------------------------------------
-- 5. Audit trigger function (SECURITY DEFINER => runs as owner, bypasses RLS)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION log_audit() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id      UUID;
  v_record_id      UUID;
  v_old            JSONB;
  v_new            JSONB;
  v_actor_id       UUID;
  v_correlation_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
    v_record_id := OLD.id;
    v_old       := to_jsonb(OLD);
    v_new       := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_tenant_id := NEW.tenant_id;
    v_record_id := NEW.id;
    v_old       := NULL;
    v_new       := to_jsonb(NEW);
  ELSE -- UPDATE
    v_tenant_id := NEW.tenant_id;
    v_record_id := NEW.id;
    v_old       := to_jsonb(OLD);
    v_new       := to_jsonb(NEW);
  END IF;

  v_actor_id       := app_current_actor_id();
  v_correlation_id := app_current_correlation_id();

  INSERT INTO "audit_log" (
    "tenant_id", "table_name", "record_id", "operation",
    "actor_id", "correlation_id", "old_data", "new_data"
  ) VALUES (
    v_tenant_id, TG_TABLE_NAME, v_record_id, TG_OP::"audit_operation",
    v_actor_id, v_correlation_id, v_old, v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to tenant-scoped tables (NOT to tenants itself — it has no tenant_id column)
CREATE TRIGGER "users_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER "properties_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "properties"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

-- ----------------------------------------------------------------------------
-- 6. GRANTs to pms_app (the role used by the API at runtime)
-- ----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "tenants"    TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "users"      TO pms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "properties" TO pms_app;
GRANT SELECT                          ON "audit_log" TO pms_app;

-- Functions used by RLS policies must be callable by the app role.
GRANT EXECUTE ON FUNCTION app_current_tenant_id()     TO pms_app;
GRANT EXECUTE ON FUNCTION app_current_actor_id()      TO pms_app;
GRANT EXECUTE ON FUNCTION app_current_correlation_id() TO pms_app;

-- Default privileges for any future tables created by the owner
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pms_app;
