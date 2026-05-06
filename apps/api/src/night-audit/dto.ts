import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const RunNightAuditDto = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
});
export type RunNightAuditDto = z.infer<typeof RunNightAuditDto>;

export const ListRunsQuery = z.object({
  propertyId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuery>;

export const StateQuery = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
});
export type StateQuery = z.infer<typeof StateQuery>;
