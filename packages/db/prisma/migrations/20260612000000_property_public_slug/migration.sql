-- ----------------------------------------------------------------------------
-- Sprint 8 W1 — IBE: slug público de property + flag de publicación.
--
-- public_slug es opaco al cliente (no expone tenantId ni propertyId).
-- Unique en el conjunto del sistema; el hotel lo escoge al publicar.
-- published_at NULL significa "no expuesto al IBE público".
-- ----------------------------------------------------------------------------

ALTER TABLE "properties"
  ADD COLUMN "public_slug"  TEXT,
  ADD COLUMN "published_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "properties_public_slug_key"
  ON "properties" ("public_slug")
  WHERE "public_slug" IS NOT NULL;
