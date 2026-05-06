-- ----------------------------------------------------------------------------
-- Sprint 2 W3 — Folio idempotency.
-- Adds idempotency_key to folio_entries so duplicate POSTs (network retries,
-- copilot tool re-confirmation) produce a single entry per (folio, key).
-- ----------------------------------------------------------------------------

ALTER TABLE "folio_entries"
  ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "folio_entries_folio_id_idempotency_key_key"
  ON "folio_entries" ("folio_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
