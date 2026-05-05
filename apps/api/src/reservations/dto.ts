import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const CreateReservationDto = z
  .object({
    propertyId: z.string().uuid(),
    guestId: z.string().uuid().optional(),
    guestData: z
      .object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        nationality: z.string().length(2).optional(),
      })
      .optional(),
    arrival: isoDate,
    departure: isoDate,
    roomTypeId: z.string().uuid(),
    ratePlanId: z.string().uuid().optional(),
    occupancy: z.object({
      adults: z.number().int().min(1).max(10),
      children: z.number().int().min(0).max(10).default(0),
    }),
    totalAmount: z.number().nonnegative().optional(),
    currency: z.string().length(3).default('EUR'),
    specialRequests: z.string().max(2000).optional(),
    notes: z.string().max(2000).optional(),
    walkIn: z.boolean().default(false),
  })
  .refine((v) => v.guestId || v.guestData, {
    message: 'either guestId or guestData is required',
  })
  .refine((v) => v.departure > v.arrival, {
    message: 'departure must be after arrival',
    path: ['departure'],
  });

export type CreateReservationDto = z.infer<typeof CreateReservationDto>;

export const PatchReservationDto = z
  .object({
    arrival: isoDate.optional(),
    departure: isoDate.optional(),
    roomTypeId: z.string().uuid().optional(),
    ratePlanId: z.string().uuid().optional(),
    occupancy: z
      .object({
        adults: z.number().int().min(1).max(10),
        children: z.number().int().min(0).max(10),
      })
      .optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => !(v.arrival && v.departure) || v.departure > v.arrival,
    { message: 'departure must be after arrival', path: ['departure'] },
  );

export type PatchReservationDto = z.infer<typeof PatchReservationDto>;

export const CancelReservationDto = z.object({
  reason: z.string().min(1).max(500),
  policyApplied: z.string().max(200).optional(),
});

export type CancelReservationDto = z.infer<typeof CancelReservationDto>;

export const AssignRoomDto = z.object({
  roomId: z.string().uuid(),
});

export type AssignRoomDto = z.infer<typeof AssignRoomDto>;

export const CheckInDto = z.object({
  roomId: z.string().uuid().optional(),
});

export type CheckInDto = z.infer<typeof CheckInDto>;

export const CheckOutDto = z.object({
  settle: z.boolean().default(false),
});

export type CheckOutDto = z.infer<typeof CheckOutDto>;
