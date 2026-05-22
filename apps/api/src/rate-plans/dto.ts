import { z } from 'zod';

const CodeRegex = /^[A-Z][A-Z0-9_-]{0,15}$/;

export const CreateRatePlanDto = z.object({
  code: z.string().regex(CodeRegex, 'code must be uppercase A-Z, 0-9, _ or - (max 16)'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
  currency: z.string().length(3).optional(),
  nonRefundable: z.boolean().default(false),
  discountPct: z.number().min(0).max(100).optional(),
  /** Tarifa diaria fija (sobreescribe RoomType.defaultRate). */
  dailyRate: z.number().nonnegative().optional(),
});
export type CreateRatePlanDto = z.infer<typeof CreateRatePlanDto>;

export const UpdateRatePlanDto = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
  nonRefundable: z.boolean().optional(),
  discountPct: z.number().min(0).max(100).nullable().optional(),
  dailyRate: z.number().nonnegative().nullable().optional(),
});
export type UpdateRatePlanDto = z.infer<typeof UpdateRatePlanDto>;
