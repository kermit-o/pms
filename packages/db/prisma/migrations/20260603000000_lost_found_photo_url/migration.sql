-- ----------------------------------------------------------------------------
-- Sprint 5 W4 — Lost & Found photos a S3 (URL firmada).
--
-- Anade photo_url. La columna photo_base64 se mantiene durante 1 release
-- para rollback (entornos sin S3 siguen escribiendo ahi). En el siguiente
-- sprint se borra tras backfill.
-- ----------------------------------------------------------------------------

ALTER TABLE "lost_found_items" ADD COLUMN "photo_url" TEXT;
