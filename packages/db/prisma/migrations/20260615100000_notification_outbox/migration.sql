-- Sprint 11 W2 — Notification outbox.
-- Auditoría + dedup del NATS consumer de emails. dedup_key = envelope.id
-- (UUID v4 del publisher); re-entregas consultan esta tabla antes de
-- reenviar a Postmark.

CREATE TYPE "notification_outbox_status" AS ENUM (
  'PENDING', 'DELIVERED', 'FAILED', 'SUPPRESSED'
);

CREATE TABLE "notification_outbox" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dedup_key"    text NOT NULL,
  "template"     text NOT NULL,
  "recipient"    citext NOT NULL,
  "locale"       text NOT NULL DEFAULT 'es',
  "params"       jsonb NOT NULL,
  "status"       "notification_outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempts"     int NOT NULL DEFAULT 0,
  "last_error"   text,
  "message_id"   text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "delivered_at" timestamptz,
  "failed_at"    timestamptz,
  CONSTRAINT "notification_outbox_dedup_key_unique" UNIQUE ("dedup_key")
);

CREATE INDEX "notification_outbox_status_created_idx"
  ON "notification_outbox" ("status", "created_at");

-- Sin RLS — global como email_suppressions (la tabla guarda envíos a
-- huéspedes que viven en un único tenant, pero el consumer no opera con
-- contexto de tenant. El payload Json mantiene la trazabilidad).
