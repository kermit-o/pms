import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const guestDataShape = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  nationality: z.string().length(2).optional(),
});

const occupancyShape = z.object({
  adults: z.number().int().min(1).max(10),
  children: z.number().int().min(0).max(10).default(0),
});

const guaranteeShape = z.object({
  type: z.enum(['NONE', 'CARD_ON_FILE', 'DEPOSIT', 'CORPORATE', 'HOTEL_GUARANTEE']),
  amount: z.number().nonnegative().optional(),
  reference: z.string().max(200).optional(),
  cancellationPolicyId: z.string().uuid().optional(),
});
export type GuaranteeInput = z.infer<typeof guaranteeShape>;

const baseReservationShape = z.object({
  propertyId: z.string().uuid(),
  guestId: z.string().uuid().optional(),
  guestData: guestDataShape.optional(),
  arrival: isoDate,
  departure: isoDate,
  roomTypeId: z.string().uuid(),
  ratePlanId: z.string().uuid().optional(),
  occupancy: occupancyShape,
  totalAmount: z.number().nonnegative().optional(),
  currency: z.string().length(3).default('EUR'),
  specialRequests: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
  walkIn: z.boolean().default(false),
  guarantee: guaranteeShape.optional(),
});

export const UpdateGuaranteeDto = z.object({
  type: z.enum(['NONE', 'CARD_ON_FILE', 'DEPOSIT', 'CORPORATE', 'HOTEL_GUARANTEE']).optional(),
  status: z.enum(['PENDING', 'SECURED', 'EXPIRED', 'FAILED', 'RELEASED']).optional(),
  amount: z.number().nonnegative().optional(),
  reference: z.string().max(200).optional(),
});
export type UpdateGuaranteeDto = z.infer<typeof UpdateGuaranteeDto>;

export const CreateReservationDto = baseReservationShape
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
    occupancy: occupancyShape.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => !(v.arrival && v.departure) || v.departure > v.arrival, {
    message: 'departure must be after arrival',
    path: ['departure'],
  });

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

const groupChildShape = baseReservationShape.omit({ propertyId: true });

export const CreateReservationGroupDto = z
  .object({
    propertyId: z.string().uuid(),
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(40).optional(),
    organizerName: z.string().max(200).optional(),
    organizerEmail: z.string().email().optional(),
    organizerPhone: z.string().max(40).optional(),
    notes: z.string().max(2000).optional(),
    reservations: z.array(groupChildShape).min(2).max(50),
  })
  .superRefine((v, ctx) => {
    v.reservations.forEach((r, i) => {
      if (!r.guestId && !r.guestData) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reservations', i],
          message: 'either guestId or guestData is required',
        });
      }
      if (!(r.departure > r.arrival)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reservations', i, 'departure'],
          message: 'departure must be after arrival',
        });
      }
    });
  });

export type CreateReservationGroupDto = z.infer<typeof CreateReservationGroupDto>;

// PATCH a nivel grupo. Los campos provistos se propagan a todas las
// reservas hijas (cascadeFields) o solo al grupo (organizerName, notes).
// Las reservas hijas mantienen sus diferencias individuales en lo NO
// especificado aqui (huespedes, roomTypeId si no se pasa, etc).
export const PatchReservationGroupDto = z
  .object({
    name: z.string().min(1).max(200).optional(),
    organizerName: z.string().max(200).optional(),
    organizerEmail: z.string().email().optional(),
    organizerPhone: z.string().max(40).optional(),
    notes: z.string().max(2000).optional(),
    // Cascade fields — se aplican a TODAS las reservas hijas en CHECKED_IN
    // o PENDING/CONFIRMED. Reservas CHECKED_OUT/CANCELLED se ignoran.
    arrival: isoDate.optional(),
    departure: isoDate.optional(),
    roomTypeId: z.string().uuid().optional(),
    ratePlanId: z.string().uuid().optional(),
  })
  .refine((v) => !(v.arrival && v.departure) || v.departure > v.arrival, {
    message: 'departure must be after arrival',
    path: ['departure'],
  });
export type PatchReservationGroupDto = z.infer<typeof PatchReservationGroupDto>;

// Bulk ops sobre el grupo entero. Aplican a reservas no-terminales del
// grupo (skip CHECKED_OUT, CANCELLED, NO_SHOW).
export const BulkGroupActionDto = z.object({
  // opcional: notas para todas las acciones (motivo, comentario)
  notes: z.string().max(500).optional(),
});
export type BulkGroupActionDto = z.infer<typeof BulkGroupActionDto>;
