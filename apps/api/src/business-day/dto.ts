import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const CloseDayDto = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
});
export type CloseDayDto = z.infer<typeof CloseDayDto>;

export const ReopenDayDto = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
  reason: z.string().min(1).max(500),
});
export type ReopenDayDto = z.infer<typeof ReopenDayDto>;

export const ListDaysQuery = z.object({
  propertyId: z.string().uuid(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListDaysQuery = z.infer<typeof ListDaysQuery>;
