-- Sprint 9 W3 — Onboarding wizard self-service.
-- Añade tenants.onboarding_status para que el wizard pueda rastrear en qué
-- paso quedó el solicitante. Valores típicos: 'EMAIL_VERIFY',
-- 'EMAIL_VERIFIED', 'SETUP_DONE'. NULL en tenants creados manualmente.

ALTER TABLE "tenants" ADD COLUMN "onboarding_status" text;
