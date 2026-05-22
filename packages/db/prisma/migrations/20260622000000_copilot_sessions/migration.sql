-- Sprint 13 — Tabla de sesiones del Copilot.
--
-- Hasta ahora `copilot_messages` era el único sitio donde vivía una
-- sesión: el sessionId aparecía sólo como columna del primer mensaje.
-- Eso obliga a perder metadatos al recargar (propertyId queda null
-- → el LLM pregunta al usuario). Tabla pequeña que cierra el hueco
-- sin tocar el flujo existente.
--
-- - `property_id` es opcional: una sesión puede no estar atada a una
--   property hasta que el operador lo confirme.
-- - `deleted_at` para soft-delete; cascada por tenant.
-- - No incluye `messages` (siguen en `copilot_messages` con FK
--   lógica por sessionId, no FK física para no romper el create
--   path existente que inserta el primer mensaje antes de tener
--   un row en sessions).
--
-- Forward-only, retro-compat con sesiones pre-existentes: no se
-- intenta backfill; las que no tengan row en sessions se siguen
-- hidratando con propertyId=null (mismo comportamiento que hoy).

CREATE TABLE "copilot_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "property_id" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp(3),
  CONSTRAINT "copilot_sessions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "copilot_sessions_tenant_id_created_at_idx"
  ON "copilot_sessions"("tenant_id", "created_at");
