import { z } from 'zod';

/**
 * Eventos del módulo notifications (Sprint 9 W1).
 *
 * - `email.send_requested`: solicitado por cualquier productor; el
 *   consumer de notifications lo materializa con plantilla + envío.
 * - `reservation.confirmation_resend_requested`: alias específico del
 *   IBE para el botón "Reenviar email de confirmación" — facilita
 *   tracear vs un email genérico.
 */

export const emailSendRequestedV1 = z.object({
  template: z.enum([
    'reservation_confirmation',
    'reservation_cancelled',
    'front_desk_new_reservation',
  ]),
  to: z.string().email(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  locale: z.enum(['es', 'en']).default('es'),
  params: z.record(z.string(), z.unknown()),
  /** Identificador opcional para dedup en el consumer (idempotencia). */
  dedupKey: z.string().max(120).optional(),
});
export type EmailSendRequestedV1Payload = z.infer<typeof emailSendRequestedV1>;

export const reservationConfirmationResendRequestedV1 = z.object({
  reservationId: z.string().uuid(),
  propertyId: z.string().uuid(),
  code: z.string(),
  email: z.string().email().nullable(),
  source: z.enum(['IBE', 'BACKOFFICE']),
  requestedAt: z.string(),
});
export type ReservationConfirmationResendRequestedV1Payload = z.infer<
  typeof reservationConfirmationResendRequestedV1
>;
