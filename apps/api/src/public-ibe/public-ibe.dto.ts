import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const AvailabilityQuery = z.object({
  arrival: isoDate,
  departure: isoDate,
  adults: z.coerce.number().int().min(1).max(10).default(2),
  children: z.coerce.number().int().min(0).max(10).default(0),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;

export const CreatePublicReservationDto = z.object({
  arrival: isoDate,
  departure: isoDate,
  roomTypeId: z.string().uuid(),
  ratePlanId: z.string().uuid().optional(),
  occupancy: z.object({
    adults: z.number().int().min(1).max(10),
    children: z.number().int().min(0).max(10).default(0),
  }),
  guest: z.object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    email: z.string().email(),
    phone: z.string().min(5).max(40).optional(),
    documentType: z.enum(['DNI', 'NIE', 'PASSPORT', 'OTHER']).optional(),
    documentNumber: z.string().min(3).max(40).optional(),
    nationality: z.string().length(2).optional(),
    gdprConsent: z.literal(true),
    marketingConsent: z.boolean().default(false),
  }),
  specialRequests: z.string().max(2000).optional(),
});
export type CreatePublicReservationDto = z.infer<typeof CreatePublicReservationDto>;

export const LookupReservationQuery = z.object({
  lastName: z.string().min(1).max(80),
});
export type LookupReservationQuery = z.infer<typeof LookupReservationQuery>;

export const CancelPublicReservationDto = z.object({
  lastName: z.string().min(1).max(80),
  acceptPenalty: z.boolean().default(false),
});
export type CancelPublicReservationDto = z.infer<typeof CancelPublicReservationDto>;

export const PublicSetupIntentDto = z.object({
  lastName: z.string().min(1).max(80),
});
export type PublicSetupIntentDto = z.infer<typeof PublicSetupIntentDto>;

export const ResendConfirmationDto = z.object({
  lastName: z.string().min(1).max(80),
});
export type ResendConfirmationDto = z.infer<typeof ResendConfirmationDto>;
