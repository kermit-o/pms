import { z } from 'zod';

/**
 * Verifactu — eventos del módulo de e-invoicing AEAT.
 */

export const verifactuInvoiceSubmitRequestedV1 = z.object({
  invoiceId: z.string().uuid(),
  /** Número humano-legible de factura (serie + número). Para correlación en logs. */
  invoiceNumber: z.string(),
});
export type VerifactuInvoiceSubmitRequestedV1Payload = z.infer<
  typeof verifactuInvoiceSubmitRequestedV1
>;

export const verifactuInvoiceSubmittedV1 = z.object({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  /** Código Seguro de Verificación devuelto por AEAT. */
  csv: z.string(),
  attemptNumber: z.number().int().positive(),
});
export type VerifactuInvoiceSubmittedV1Payload = z.infer<typeof verifactuInvoiceSubmittedV1>;

export const verifactuInvoiceRejectedV1 = z.object({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  errorMessage: z.string(),
  attemptNumber: z.number().int().positive(),
  /** True si ya no se reintentará (DEAD_LETTER tras agotar maxDeliver). */
  isDeadLetter: z.boolean(),
});
export type VerifactuInvoiceRejectedV1Payload = z.infer<typeof verifactuInvoiceRejectedV1>;
