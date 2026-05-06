import { z } from 'zod';

const base = z.object({
  propertyId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const businessDayClosedV1 = base.extend({
  closedAt: z.string(),
  closedByUserId: z.string().uuid(),
});
export type BusinessDayClosedV1Payload = z.infer<typeof businessDayClosedV1>;

export const businessDayReopenedV1 = base.extend({
  reopenedAt: z.string(),
  reason: z.string().min(1),
});
export type BusinessDayReopenedV1Payload = z.infer<typeof businessDayReopenedV1>;
