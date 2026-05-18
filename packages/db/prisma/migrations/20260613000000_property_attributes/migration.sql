-- Sprint 9 W4 — Anti-abuso.
-- Añade attributes Json? a properties para almacenar configuración extensible
-- por hotel sin nuevas columnas: blockedIps (string[]), email.brand, etc.

ALTER TABLE "properties" ADD COLUMN "attributes" jsonb;
