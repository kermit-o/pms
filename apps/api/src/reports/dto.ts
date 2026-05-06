import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const ManagerReportQuery = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
});
export type ManagerReportQuery = z.infer<typeof ManagerReportQuery>;

export const RangeReportQuery = z.object({
  propertyId: z.string().uuid(),
  from: isoDate,
  to: isoDate,
});
export type RangeReportQuery = z.infer<typeof RangeReportQuery>;
