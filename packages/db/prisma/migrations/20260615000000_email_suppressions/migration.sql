-- Sprint 11 W1 — Email suppression list (global, no por tenant).
-- Postmark webhook escribe aquí en bounce/complaint/unsubscribe; el
-- service hace pre-check antes de invocar Postmark.

CREATE TYPE "email_suppression_reason" AS ENUM (
  'HARD_BOUNCE', 'SPAM_COMPLAINT', 'UNSUBSCRIBE', 'MANUAL'
);

CREATE TABLE "email_suppressions" (
  "email"      citext PRIMARY KEY,
  "reason"     "email_suppression_reason" NOT NULL,
  "detail"     text,
  "source"     text NOT NULL DEFAULT 'postmark',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- No tiene RLS — es global al SaaS (la reputación del dominio remitente
-- también lo es).
