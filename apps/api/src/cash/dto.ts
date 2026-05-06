import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const UpsertReconciliationDto = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
  countedAmount: z.number().nonnegative(),
  currency: z.string().length(3).default('EUR'),
  toleranceCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});
export type UpsertReconciliationDto = z.infer<typeof UpsertReconciliationDto>;

export const ReconciliationQuery = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
});
export type ReconciliationQuery = z.infer<typeof ReconciliationQuery>;
