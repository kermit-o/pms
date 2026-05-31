-- ----------------------------------------------------------------------------
-- Sprint 14 W2 — Verifactu: emisor del tenant + encadenamiento de huellas.
--
-- Ver ADR-032. Tres cambios:
--
--   1. tenants gana `nif` + `razon_social`. Modelo §5.a (un IDEmisor por
--      tenant). Nullable porque hay tenants pre-Verifactu; el onboarding
--      bloquea la emisión hasta que estén poblados.
--   2. invoices gana `tipo_factura` (enum F1/F2) + `huella` + `huella_anterior`
--      (CHAR(64) hex SHA-256). El encadenamiento se llena en `issue()`.
--   3. Índice secundario para localizar la última factura por emisor (para
--      el lock FOR UPDATE de la cadena).
--
-- Forward-only. No DROP. Si en V2 movemos el emisor a Property (modelo §5.b),
-- otra migración nueva.
-- ----------------------------------------------------------------------------

-- 1) Tenant: NIF + razón social del emisor.
ALTER TABLE "tenants"
  ADD COLUMN "nif"           TEXT,
  ADD COLUMN "razon_social"  TEXT;

-- 2) Invoice: tipo + huellas.
CREATE TYPE "verifactu_tipo_factura" AS ENUM ('F1', 'F2');

ALTER TABLE "invoices"
  ADD COLUMN "tipo_factura"      "verifactu_tipo_factura" NOT NULL DEFAULT 'F1',
  ADD COLUMN "huella"            CHAR(64),
  ADD COLUMN "huella_anterior"   CHAR(64);

-- 3) Índice para el lock secuencial por emisor: localizar la última factura
--    encadenada del tenant para usarla como huella_anterior de la siguiente.
--    Ordenamos por issued_at desc (el huella se enlaza por orden de emisión,
--    no por número/serie — un tenant puede tener varias series en paralelo).
--    `WHERE huella IS NOT NULL` excluye los registros pre-Verifactu (que
--    nunca participan en la cadena).
CREATE INDEX "invoices_tenant_issued_chain_idx"
  ON "invoices" ("tenant_id", "issued_at" DESC)
  WHERE "huella" IS NOT NULL;
