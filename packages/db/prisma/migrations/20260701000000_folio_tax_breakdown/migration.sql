-- ----------------------------------------------------------------------------
-- RFC-001 — IVA por línea + city tax en folio (PR #1).
--
-- Migración expand-only (CLAUDE.md §15). Añadimos:
--   * 4 columnas nullable en folio_entries (net_amount, tax_rate,
--     tax_amount, tax_category). Las filas existentes quedan como
--     "legacy" — la UI las pinta sin desglose y el FolioService no
--     valida invariante sobre ellas.
--   * Enum tax_category nuevo.
--   * Tabla property_tax_configs — matriz IVA por property y categoría,
--     histórica (cada cambio crea una fila nueva con effective_from).
--   * Tabla city_tax_rules — una regla por property (region + importe +
--     exenciones + cap).
--   * Enum city_tax_region nuevo.
--
-- Ambas tablas nuevas con RLS por tenant_id, audit trigger, y GRANT al
-- rol pms_app (mismo patrón que migraciones previas, ej. 20260629_*).
--
-- Sin DROP, sin RENAME, sin NOT NULL en columnas existentes —
-- compatible con escritura concurrente del API ya desplegado.
-- ----------------------------------------------------------------------------

-- Enums nuevos -------------------------------------------------------------

CREATE TYPE "tax_category" AS ENUM (
  'ROOM',
  'BREAKFAST',
  'EXTRA_FOOD',
  'EXTRA_OTHER',
  'CITY_TAX',
  'EXEMPT'
);

CREATE TYPE "city_tax_region" AS ENUM (
  'NONE',
  'CATALUNYA',
  'BALEARES',
  'COMUNIDAD_VALENCIANA'
);

-- folio_entries: 4 columnas nuevas, todas nullable ------------------------

ALTER TABLE "folio_entries"
  ADD COLUMN "net_amount"   DECIMAL(12, 2),
  ADD COLUMN "tax_rate"     DECIMAL(5, 2),
  ADD COLUMN "tax_amount"   DECIMAL(12, 2),
  ADD COLUMN "tax_category" "tax_category";

CREATE INDEX "folio_entries_tenant_id_tax_category_idx"
  ON "folio_entries" ("tenant_id", "tax_category");

-- property_tax_configs -----------------------------------------------------

CREATE TABLE "property_tax_configs" (
  "id"             UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"      UUID            NOT NULL,
  "property_id"    UUID            NOT NULL,
  "category"       "tax_category"  NOT NULL,
  "tax_rate"       DECIMAL(5, 2)   NOT NULL,
  "effective_from" DATE            NOT NULL DEFAULT CURRENT_DATE,
  "created_at"     TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_tax_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "property_tax_configs_property_id_category_effective_from_key"
    UNIQUE ("property_id", "category", "effective_from"),
  CONSTRAINT "property_tax_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "property_tax_configs_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "property_tax_configs_tenant_id_property_id_idx"
  ON "property_tax_configs" ("tenant_id", "property_id");

ALTER TABLE "property_tax_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_tax_configs" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "property_tax_configs_tenant_isolation"
  ON "property_tax_configs"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "property_tax_configs_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "property_tax_configs"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "property_tax_configs" TO pms_app;

-- city_tax_rules -----------------------------------------------------------

CREATE TABLE "city_tax_rules" (
  "id"                  UUID              NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID              NOT NULL,
  "property_id"         UUID              NOT NULL,
  "region"              "city_tax_region" NOT NULL DEFAULT 'NONE',
  "amount_per_night"    DECIMAL(8, 2)     NOT NULL DEFAULT 0,
  "applies_to_adults"   BOOLEAN           NOT NULL DEFAULT true,
  "applies_to_children" BOOLEAN           NOT NULL DEFAULT false,
  "child_age_threshold" INTEGER           NOT NULL DEFAULT 16,
  "max_nights"          INTEGER           NOT NULL DEFAULT 7,
  "effective_from"      DATE              NOT NULL DEFAULT CURRENT_DATE,
  "created_at"          TIMESTAMPTZ(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(3)    NOT NULL,
  CONSTRAINT "city_tax_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "city_tax_rules_property_id_key" UNIQUE ("property_id"),
  CONSTRAINT "city_tax_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "city_tax_rules_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "city_tax_rules_tenant_id_property_id_idx"
  ON "city_tax_rules" ("tenant_id", "property_id");

ALTER TABLE "city_tax_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "city_tax_rules" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "city_tax_rules_tenant_isolation"
  ON "city_tax_rules"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE TRIGGER "city_tax_rules_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "city_tax_rules"
  FOR EACH ROW EXECUTE FUNCTION log_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON "city_tax_rules" TO pms_app;
