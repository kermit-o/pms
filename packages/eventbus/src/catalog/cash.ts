import { z } from 'zod';

const base = z.object({
  reconciliationId: z.string().uuid(),
  propertyId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const cashReconciliationCreatedV1 = base.extend({
  expectedAmount: z.string(),
  countedAmount: z.string(),
  discrepancy: z.string(),
  currency: z.string().length(3),
  countedByUserId: z.string().uuid().nullable(),
});
export type CashReconciliationCreatedV1Payload = z.infer<typeof cashReconciliationCreatedV1>;

export const cashReconciliationDiscrepancyV1 = base.extend({
  expectedAmount: z.string(),
  countedAmount: z.string(),
  discrepancy: z.string(),
  currency: z.string().length(3),
  toleranceCents: z.number().int().nonnegative(),
});
export type CashReconciliationDiscrepancyV1Payload = z.infer<
  typeof cashReconciliationDiscrepancyV1
>;
