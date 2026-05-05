import { z } from 'zod';

export const AddChargeDto = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  type: z.enum(['CHARGE', 'TAX']).default('CHARGE'),
  idempotencyKey: z.string().min(1).max(120).optional(),
});

export type AddChargeDto = z.infer<typeof AddChargeDto>;

const PaymentMethod = z.enum([
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'OTHER',
]);

export const AddPaymentDto = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  paymentMethod: PaymentMethod,
  reference: z.string().max(120).optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
});

export type AddPaymentDto = z.infer<typeof AddPaymentDto>;

export const ReopenFolioDto = z.object({
  reason: z.string().min(1).max(500),
});

export type ReopenFolioDto = z.infer<typeof ReopenFolioDto>;
