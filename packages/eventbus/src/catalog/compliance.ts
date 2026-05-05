import { z } from 'zod';

const base = z.object({
  submissionId: z.string().uuid(),
  propertyId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const sesSubmissionQueuedV1 = base.extend({
  guestCount: z.number().int().min(0),
});
export type SesSubmissionQueuedV1Payload = z.infer<typeof sesSubmissionQueuedV1>;

export const sesSubmissionSentV1 = base.extend({
  responseCode: z.number().int(),
  submittedAt: z.string(),
});
export type SesSubmissionSentV1Payload = z.infer<typeof sesSubmissionSentV1>;

export const sesSubmissionFailedV1 = base.extend({
  retryCount: z.number().int().min(0),
  error: z.string(),
  deadLetter: z.boolean(),
});
export type SesSubmissionFailedV1Payload = z.infer<typeof sesSubmissionFailedV1>;
