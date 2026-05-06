-- ----------------------------------------------------------------------------
-- Sprint 4 W1 — Housekeeping tasks.
--
-- One row per assigned cleaning / inspection / maintenance task. Status
-- machine: PENDING -> IN_PROGRESS -> COMPLETED. CANCELLED is terminal
-- from any non-completed state. (CompleteTask optionally transitions the
-- room status, but the room state itself lives on `rooms` from S2-W5.)
-- ----------------------------------------------------------------------------

CREATE TYPE "housekeeping_task_status" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "housekeeping_task_type" AS ENUM (
  'CHECKOUT_CLEAN',
  'STAYOVER_CLEAN',
  'INSPECTION',
  'MAINTENANCE'
);

CREATE TABLE "housekeeping_tasks" (
  "id"                   UUID                       NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            UUID                       NOT NULL,
  "property_id"          UUID                       NOT NULL,
  "room_id"              UUID                       NOT NULL,
  "business_date"        DATE                       NOT NULL,
  "task_type"            "housekeeping_task_type"    NOT NULL DEFAULT 'CHECKOUT_CLEAN',
  "status"               "housekeeping_task_status"  NOT NULL DEFAULT 'PENDING',
  "assigned_to_user_id"  UUID,
  "assigned_at"          TIMESTAMPTZ(3),
  "started_at"           TIMESTAMPTZ(3),
  "completed_at"         TIMESTAMPTZ(3),
  "duration_min"         INTEGER,
  "scheduled_for"        TIMESTAMPTZ(3),
  "notes"                TEXT,
  "result"               JSONB,
  "attributes"           JSONB,
  "created_at"           TIMESTAMPTZ(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(3)             NOT NULL,
  "deleted_at"           TIMESTAMPTZ(3),
  CONSTRAINT "housekeeping_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "housekeeping_tasks_property_id_business_date_room_id_task_type_key"
    UNIQUE ("property_id", "business_date", "room_id", "task_type"),
  CONSTRAINT "housekeeping_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "housekeeping_tasks_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "housekeeping_tasks_room_id_fkey" FOREIGN KEY ("room_id")
    REFERENCES "rooms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "housekeeping_tasks_tenant_id_property_id_status_scheduled_for_idx"
  ON "housekeeping_tasks" ("tenant_id", "property_id", "status", "scheduled_for");
CREATE INDEX "housekeeping_tasks_tenant_id_assigned_to_user_id_idx"
  ON "housekeeping_tasks" ("tenant_id", "assigned_to_user_id");
CREATE INDEX "housekeeping_tasks_tenant_id_property_id_business_date_idx"
  ON "housekeeping_tasks" ("tenant_id", "property_id", "business_date");

-- ----------------------------------------------------------------------------
-- RLS, audit, GRANTs
-- ----------------------------------------------------------------------------

ALTER TABLE "housekeeping_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "housekeeping_tasks" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "housekeeping_tasks_tenant_isolation" ON "housekeeping_tasks"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "housekeeping_tasks_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "housekeeping_tasks"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "housekeeping_tasks" TO pms_app;
