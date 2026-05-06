-- ----------------------------------------------------------------------------
-- Sprint 4 W4 — Device pairings (login QR para moviles compartidos).
--
-- Un supervisor genera un codigo (TTL corto, ~2 min) que la camarera
-- escanea desde la PWA. El redeem consume el codigo y devuelve un JWT HMAC
-- firmado por la API (issuer = 'aubergine-pairing') con TTL largo (~12 h)
-- para la jornada. El JWT vive como cookie de sesion en el dispositivo y
-- el JwtValidatorService lo acepta como una segunda via de auth.
-- ----------------------------------------------------------------------------

CREATE TABLE "device_pairings" (
  "id"                  UUID            NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID            NOT NULL,
  "code"                CHAR(12)        NOT NULL,
  "target_user_id"      UUID            NOT NULL,
  "issued_by_user_id"   UUID            NOT NULL,
  "expires_at"          TIMESTAMPTZ(3)  NOT NULL,
  "redeemed_at"         TIMESTAMPTZ(3),
  "redeemed_token_jti"  UUID,
  "created_at"          TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_pairings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_pairings_code_key" UNIQUE ("code"),
  CONSTRAINT "device_pairings_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "device_pairings_tenant_id_target_user_id_idx"
  ON "device_pairings" ("tenant_id", "target_user_id");
CREATE INDEX "device_pairings_tenant_id_expires_at_idx"
  ON "device_pairings" ("tenant_id", "expires_at");

ALTER TABLE "device_pairings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_pairings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "device_pairings_tenant_isolation" ON "device_pairings"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- El redeem viene con (tenantId, code) en el payload: el QR codifica
-- ambos campos. tenantId no es secreto; el codigo si lo es y va dentro de
-- un fragment URL (#) cuando es posible. Con RLS habilitado todas las
-- queries usan withTenant({ tenantId }), igual que el resto del dominio.
GRANT SELECT, INSERT, UPDATE ON "device_pairings" TO pms_app;

CREATE TRIGGER "device_pairings_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "device_pairings"
  FOR EACH ROW EXECUTE FUNCTION log_audit();
