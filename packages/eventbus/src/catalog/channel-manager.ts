import { z } from 'zod';

/**
 * Eventos del módulo channel-manager (Sprint 9 W2).
 *
 * - `channel.sync_completed`: emitido tras cada intento de push/pull,
 *   exitoso o no. Permite construir dashboards de salud por hotel.
 * - `channel.inbound_reservation_received`: emitido cuando llega un booking
 *   OTA por webhook. Lo consumen reservas y notifications para confirmar
 *   al hotel.
 */

export const channelSyncCompletedV1 = z.object({
  syncRunId: z.string().uuid(),
  propertyId: z.string().uuid(),
  provider: z.string(),
  kind: z.enum(['PUSH_AVAILABILITY', 'PUSH_RATES', 'PULL_RESERVATION', 'NIGHTLY_FULL']),
  status: z.enum(['OK', 'FAILED', 'SKIPPED']),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().min(0),
  totals: z.record(z.string(), z.number()).optional(),
  error: z.string().nullable().optional(),
});
export type ChannelSyncCompletedV1Payload = z.infer<typeof channelSyncCompletedV1>;

export const channelInboundReservationReceivedV1 = z.object({
  reservationId: z.string().uuid(),
  propertyId: z.string().uuid(),
  provider: z.string(),
  externalRef: z.string(),
  source: z.enum(['BOOKING_COM', 'EXPEDIA', 'OTHER_OTA']),
  /** 'created' la primera vez; 'updated' si el externalRef ya existía. */
  outcome: z.enum(['created', 'updated']),
  arrival: z.string(),
  departure: z.string(),
});
export type ChannelInboundReservationReceivedV1Payload = z.infer<
  typeof channelInboundReservationReceivedV1
>;
