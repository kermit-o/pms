import { z } from 'zod';

export const IssueInvoiceDto = z.object({
  folioId: z.string().uuid(),
  customerName: z.string().min(1).max(200),
  customerNif: z.string().min(1).max(20).optional(),
  customerAddress: z.string().min(1).max(500).optional(),
  series: z
    .string()
    .regex(/^[A-Z][A-Z0-9-]{0,7}$/, 'series must match /^[A-Z][A-Z0-9-]{0,7}$/')
    .optional(),
});

export type IssueInvoiceDto = z.infer<typeof IssueInvoiceDto>;
