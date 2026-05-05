import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const ListRoomsQuery = z.object({
  propertyId: z.string().uuid().optional(),
  roomTypeId: z.string().uuid().optional(),
  status: z
    .enum(['CLEAN', 'DIRTY', 'INSPECTED', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'])
    .optional(),
  floor: z.string().max(20).optional(),
});
export type ListRoomsQuery = z.infer<typeof ListRoomsQuery>;

export const AvailabilityQuery = z.object({
  propertyId: z.string().uuid(),
  from: isoDate,
  to: isoDate,
  roomTypeId: z.string().uuid().optional(),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;

export const SearchAvailabilityQuery = z.object({
  propertyId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  arrival: isoDate,
  departure: isoDate,
});
export type SearchAvailabilityQuery = z.infer<typeof SearchAvailabilityQuery>;

export const ChangeStatusDto = z.object({
  status: z.enum([
    'CLEAN',
    'DIRTY',
    'INSPECTED',
    'OUT_OF_ORDER',
    'OUT_OF_SERVICE',
  ]),
  outOfOrderReason: z.string().max(500).optional(),
});
export type ChangeStatusDto = z.infer<typeof ChangeStatusDto>;
