-- ----------------------------------------------------------------------------
-- Iter B reservations UI: Agencia / Empresa / VIP.
--
-- Reservation gana agency_name y company_name (string denormalizado V1 — el
-- catalogo de agencias y empresas con FK llega cuando el revenue manager lo
-- justifique con datos de uso). Guest gana membership_level libre (Gold,
-- Platinum, VIP, etc.). Indices ligeros para los filtros de la tabla.
-- ----------------------------------------------------------------------------

ALTER TABLE "reservations"
  ADD COLUMN "agency_name"  TEXT,
  ADD COLUMN "company_name" TEXT;

ALTER TABLE "guests"
  ADD COLUMN "membership_level" TEXT;

CREATE INDEX "reservations_tenant_agency_name_idx"
  ON "reservations" ("tenant_id", "agency_name")
  WHERE "agency_name" IS NOT NULL;
CREATE INDEX "reservations_tenant_company_name_idx"
  ON "reservations" ("tenant_id", "company_name")
  WHERE "company_name" IS NOT NULL;
CREATE INDEX "guests_tenant_membership_level_idx"
  ON "guests" ("tenant_id", "membership_level")
  WHERE "membership_level" IS NOT NULL;
