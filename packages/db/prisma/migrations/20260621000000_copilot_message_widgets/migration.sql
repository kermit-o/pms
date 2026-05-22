-- Sprint 13 — Persistencia de widgets del Copilot.
--
-- Cada mensaje del asistente puede llevar widgets estructurados emitidos
-- por tools read-only (disponibilidad, folio, ficha de reserva…). Se
-- guardan tal cual JSON para que:
--   - el agentic loop pueda rehidratar la sesión si se añade reload-from-DB;
--   - análisis Grafana / audit puedan inspeccionar qué widgets recibió cada
--     hotel sin re-ejecutar tools;
--   - drift de prompt sea visible (cuántas veces el LLM ignoró el widget y
--     reformuló el contenido en texto).
--
-- Nullable porque la mayoría de mensajes no llevan widget; default NULL
-- mantiene retro-compat con filas existentes.

ALTER TABLE "copilot_messages" ADD COLUMN "widgets" jsonb;
