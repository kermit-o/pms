-- ----------------------------------------------------------------------------
-- Sprint 7 W2 — Memoria semántica del huésped (V1: tsvector full-text).
--
-- guest_memory_chunks almacena trozos de texto extraídos del cardex y de
-- las estancias del huésped. Esos chunks alimentan al copilot cuando el
-- operador pregunta "qué pidió Pérez la última vez" / "tiene alergias?".
--
-- V1 hace ranking con tsvector + ts_rank (sin dependencia npm). V1.1
-- añadirá pgvector + embeddings reales (text-embedding-3-small u otro)
-- cuando se apruebe la dep — la tabla queda preparada con vector_pending
-- = true para que la migración futura sea expand-only.
--
-- Ver docs/SPRINT-7-PLAN.md §3.
-- ----------------------------------------------------------------------------

CREATE TYPE "guest_memory_source_kind" AS ENUM (
  'CARDEX',
  'STAY_NOTE',
  'FOLIO_NOTE',
  'SPECIAL_REQUEST'
);

CREATE TABLE "guest_memory_chunks" (
  "id"           UUID                       NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"    UUID                       NOT NULL,
  "guest_id"     UUID                       NOT NULL,
  "source_kind"  "guest_memory_source_kind" NOT NULL,
  "source_ref"   TEXT,
  "chunk_text"   TEXT                       NOT NULL,
  "tsv"          TSVECTOR
                 GENERATED ALWAYS AS (to_tsvector('spanish', "chunk_text")) STORED,
  "vector_pending" BOOLEAN                  NOT NULL DEFAULT TRUE,
  "created_at"   TIMESTAMPTZ(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMPTZ(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guest_memory_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guest_memory_chunks_unique"
    UNIQUE ("guest_id", "source_kind", "source_ref"),
  CONSTRAINT "guest_memory_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE,
  CONSTRAINT "guest_memory_chunks_guest_id_fkey" FOREIGN KEY ("guest_id")
    REFERENCES "guests" ("id") ON DELETE CASCADE
);

CREATE INDEX "guest_memory_chunks_tenant_guest_idx"
  ON "guest_memory_chunks" ("tenant_id", "guest_id");
CREATE INDEX "guest_memory_chunks_tsv_idx"
  ON "guest_memory_chunks" USING GIN ("tsv");

-- RLS por tenant + grants.
ALTER TABLE "guest_memory_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_memory_chunks" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "guest_memory_chunks_tenant_isolation" ON "guest_memory_chunks"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "guest_memory_chunks" TO pms_app;
