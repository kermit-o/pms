-- ----------------------------------------------------------------------------
-- Sprint 6 W1 — Copilot messages audit trail.
--
-- One row per turn in a copilot conversation: user prompts, assistant
-- responses, tool_use intents, tool_result outcomes. Persisted for legal
-- audit (who asked what, when) and observabilidad de coste (tokens per
-- tenant, prompt cache effectiveness). Retention policy lives in the NA
-- pipeline — old rows pruned per tenant policy.
--
-- See docs/SPRINT-6-PLAN.md §2.2.
-- ----------------------------------------------------------------------------

CREATE TYPE "copilot_message_role" AS ENUM (
  'USER',
  'ASSISTANT',
  'TOOL_USE',
  'TOOL_RESULT'
);

CREATE TABLE "copilot_messages" (
  "id"                  UUID                  NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID                  NOT NULL,
  "session_id"          UUID                  NOT NULL,
  "user_id"             UUID                  NOT NULL,
  "role"                "copilot_message_role" NOT NULL,
  "content_text"        TEXT,
  "tool_name"           TEXT,
  "tool_input"          JSONB,
  "tool_result"         JSONB,
  "model"               TEXT,
  "input_tokens"        INTEGER,
  "output_tokens"       INTEGER,
  "cache_read_tokens"   INTEGER,
  "cache_write_tokens"  INTEGER,
  "latency_ms"          INTEGER,
  "created_at"          TIMESTAMPTZ(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "copilot_messages_session_id_created_at_idx"
  ON "copilot_messages" ("session_id", "created_at");
CREATE INDEX "copilot_messages_tenant_id_created_at_idx"
  ON "copilot_messages" ("tenant_id", "created_at");

-- ----------------------------------------------------------------------------
-- RLS, audit, GRANTs.
--
-- Note: copilot messages are NOT mirrored to audit_log — they ARE the audit
-- trail. Adding the log_audit trigger would double the storage.
-- ----------------------------------------------------------------------------

ALTER TABLE "copilot_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copilot_messages" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "copilot_messages_tenant_isolation" ON "copilot_messages"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT ON "copilot_messages" TO pms_app;
