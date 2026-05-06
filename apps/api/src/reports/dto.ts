import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const Format = z.enum(['json', 'csv']).default('json');
export type Format = z.infer<typeof Format>;

export const ManagerReportQuery = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
  format: Format.optional(),
});
export type ManagerReportQuery = z.infer<typeof ManagerReportQuery>;

export const RangeReportQuery = z.object({
  propertyId: z.string().uuid(),
  from: isoDate,
  to: isoDate,
  format: Format.optional(),
});
export type RangeReportQuery = z.infer<typeof RangeReportQuery>;

export const DateReportQuery = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
  format: Format.optional(),
});
export type DateReportQuery = z.infer<typeof DateReportQuery>;
