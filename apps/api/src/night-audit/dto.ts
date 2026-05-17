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

export const ListAnomaliesQuery = z.object({
  propertyId: z.string().uuid().optional(),
  businessDate: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  kind: z
    .enum([
      'DUPLICATE_CHARGE',
      'CASH_DRAWER_VARIANCE',
      'DEEP_DISCOUNT',
      'CANCELLATION_SPREE',
      'RATE_OVERRIDE',
    ])
    .optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  reviewed: z.enum(['yes', 'no']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListAnomaliesQuery = z.infer<typeof ListAnomaliesQuery>;

export const ReviewAnomalyDto = z.object({
  notes: z.string().max(500).optional(),
});
export type ReviewAnomalyDto = z.infer<typeof ReviewAnomalyDto>;

export const ForecastQuery = z.object({
  propertyId: z.string().uuid(),
  horizon: z.coerce.number().int().min(7).max(90).default(30),
  metric: z.enum(['occupancy', 'adr', 'revpar', 'pickup']).default('occupancy'),
});
export type ForecastQuery = z.infer<typeof ForecastQuery>;
