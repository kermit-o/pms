import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseReservation = z.object({
  reservationId: z.string().uuid(),
  propertyId: z.string().uuid(),
  code: z.string().min(1),
});

export const reservationCreatedV1 = baseReservation.extend({
  arrivalDate: isoDate,
  departureDate: isoDate,
  roomTypeId: z.string().uuid(),
  ratePlanId: z.string().uuid().nullable(),
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  source: z.string(),
  totalAmount: z.string(),
  currency: z.string().length(3),
});
export type ReservationCreatedV1Payload = z.infer<typeof reservationCreatedV1>;

export const reservationUpdatedV1 = baseReservation.extend({
  changes: z.record(z.string(), z.unknown()),
});
export type ReservationUpdatedV1Payload = z.infer<typeof reservationUpdatedV1>;

export const reservationCancelledV1 = baseReservation.extend({
  reason: z.string().min(1),
  policyApplied: z.string().nullable().optional(),
  cancelledAt: z.string(),
});
export type ReservationCancelledV1Payload = z.infer<typeof reservationCancelledV1>;

export const reservationCheckedInV1 = baseReservation.extend({
  roomId: z.string().uuid(),
  checkedInAt: z.string(),
});
export type ReservationCheckedInV1Payload = z.infer<typeof reservationCheckedInV1>;

export const reservationCheckedOutV1 = baseReservation.extend({
  checkedOutAt: z.string(),
  finalBalance: z.string(),
});
export type ReservationCheckedOutV1Payload = z.infer<typeof reservationCheckedOutV1>;

export const reservationNoShowV1 = baseReservation.extend({
  markedAt: z.string(),
});
export type ReservationNoShowV1Payload = z.infer<typeof reservationNoShowV1>;

export const reservationRoomAssignedV1 = baseReservation.extend({
  roomId: z.string().uuid(),
  previousRoomId: z.string().uuid().nullable(),
  assignedAt: z.string(),
});
export type ReservationRoomAssignedV1Payload = z.infer<typeof reservationRoomAssignedV1>;

export const reservationGroupCreatedV1 = z.object({
  groupId: z.string().uuid(),
  propertyId: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  reservationIds: z.array(z.string().uuid()).min(1),
});
export type ReservationGroupCreatedV1Payload = z.infer<typeof reservationGroupCreatedV1>;
