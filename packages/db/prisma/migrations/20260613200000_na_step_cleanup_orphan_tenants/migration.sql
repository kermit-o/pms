-- Sprint 10 W3 — Cleanup tenants huérfanos del onboarding.
-- Añade el valor 'CLEANUP_ORPHAN_TENANTS' al enum night_audit_step para
-- registrar el paso del pipeline NA que limpia tenants `pending-*` con
-- > 7 días sin completar setup.

ALTER TYPE "night_audit_step" ADD VALUE IF NOT EXISTS 'CLEANUP_ORPHAN_TENANTS';
