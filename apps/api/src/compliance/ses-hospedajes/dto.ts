import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const QueueSubmissionDto = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
});
export type QueueSubmissionDto = z.infer<typeof QueueSubmissionDto>;

export const ListSubmissionsQuery = z.object({
  propertyId: z.string().uuid().optional(),
  status: z.enum(['QUEUED', 'SENT', 'FAILED', 'DEAD_LETTER']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListSubmissionsQuery = z.infer<typeof ListSubmissionsQuery>;
