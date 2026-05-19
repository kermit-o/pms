-- Sprint 9 W2 — Channel Manager.

-- 1. Property: provider + ids + credentials_ref.
ALTER TABLE "properties"
  ADD COLUMN "channel_manager_provider" text,
  ADD COLUMN "channel_manager_property_id" text,
  ADD COLUMN "channel_manager_credentials_ref" text;

-- 2. Sync runs (auditoría + dashboards de salud del canal).
CREATE TYPE "channel_sync_kind" AS ENUM (
  'PUSH_AVAILABILITY', 'PUSH_RATES', 'PULL_RESERVATION', 'NIGHTLY_FULL'
);

CREATE TYPE "channel_sync_status" AS ENUM (
  'IN_PROGRESS', 'OK', 'FAILED', 'SKIPPED'
);

CREATE TABLE "channel_sync_runs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL,
  "property_id"   uuid NOT NULL,
  "provider"      text NOT NULL,
  "kind"          "channel_sync_kind" NOT NULL,
  "status"        "channel_sync_status" NOT NULL DEFAULT 'IN_PROGRESS',
  "started_at"    timestamptz NOT NULL DEFAULT now(),
  "completed_at"  timestamptz,
  "error"         text,
  "totals"        jsonb,
  "external_ref"  text,
  CONSTRAINT "channel_sync_runs_property_fk"
    FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE CASCADE
);

CREATE INDEX "channel_sync_runs_tenant_property_started_idx"
  ON "channel_sync_runs" ("tenant_id", "property_id", "started_at");
CREATE INDEX "channel_sync_runs_tenant_status_idx"
  ON "channel_sync_runs" ("tenant_id", "status");

-- 3. RLS — un run pertenece al tenant del property.
ALTER TABLE "channel_sync_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_sync_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "channel_sync_runs_tenant_isolation" ON "channel_sync_runs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
