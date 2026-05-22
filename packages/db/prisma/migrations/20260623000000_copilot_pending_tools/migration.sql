-- Sprint 13 — Persistencia de pending tools del Copilot.
--
-- Hasta ahora la propuesta mutating ("Sugerencia: ejecutar X") quedaba
-- sólo en el Map in-memory. Tras un deploy/reinicio:
--   - El mensaje se conservaba (estaba en copilot_messages).
--   - Pero los botones Approve/Reject desaparecían porque no había
--     PendingTool en el Map ni `pendingToolId` en el mensaje cargado.
-- Resultado: el operador tenía que re-pedir la acción al Copilot.
--
-- Esta migración añade:
--   1. Tabla `copilot_pending_tools` con (id, session_id, tool_name,
--      input jsonb, financial, status, created_at, decided_at?,
--      decision?).
--   2. Columna `pending_tool_id` en `copilot_messages` para reconectar
--      el mensaje con su pendingTool al rehidratar la sesión.
--
-- Forward-only, retro-compat: el column nuevo es nullable; las
-- sesiones existentes se cargan sin pendingTools (igual que antes).

CREATE TABLE "copilot_pending_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL,
  "tool_name" text NOT NULL,
  "input" jsonb NOT NULL,
  "financial" boolean NOT NULL DEFAULT false,
  -- Valores: 'pending' | 'approved' | 'rejected' | 'failed'.
  -- Texto + check constraint es más liviano que un enum SQL para esto.
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" timestamp(3),
  CONSTRAINT "copilot_pending_tools_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'failed'))
);

CREATE INDEX "copilot_pending_tools_session_id_status_idx"
  ON "copilot_pending_tools"("session_id", "status");

ALTER TABLE "copilot_messages"
  ADD COLUMN "pending_tool_id" uuid;
