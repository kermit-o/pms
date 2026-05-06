import { z } from 'zod';

const base = z.object({
  runId: z.string().uuid(),
  propertyId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const nightAuditRunStartedV1 = base.extend({
  startedAt: z.string(),
  startedByUserId: z.string().uuid().nullable(),
});
export type NightAuditRunStartedV1Payload = z.infer<typeof nightAuditRunStartedV1>;

export const nightAuditStepCompletedV1 = base.extend({
  step: z.string(),
  durationMs: z.number().int().nonnegative(),
  result: z.unknown().optional(),
});
export type NightAuditStepCompletedV1Payload = z.infer<typeof nightAuditStepCompletedV1>;

export const nightAuditStepFailedV1 = base.extend({
  step: z.string(),
  error: z.string(),
});
export type NightAuditStepFailedV1Payload = z.infer<typeof nightAuditStepFailedV1>;

export const nightAuditRunCompletedV1 = base.extend({
  completedAt: z.string(),
  totals: z.record(z.string(), z.unknown()),
});
export type NightAuditRunCompletedV1Payload = z.infer<typeof nightAuditRunCompletedV1>;
