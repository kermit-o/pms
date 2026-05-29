import { z } from 'zod';

/**
 * Verifactu — eventos del módulo de e-invoicing AEAT.
 *
 * Por ahora un único evento. `submitted` y `rejected` se añadirán cuando
 * el SubmitWorker exista — no añadimos catálogo que nadie consume.
 */

export const verifactuInvoiceSubmitRequestedV1 = z.object({
  invoiceId: z.string().uuid(),
  /** Número humano-legible de factura (serie + número). Para correlación en logs. */
  invoiceNumber: z.string(),
});
export type VerifactuInvoiceSubmitRequestedV1Payload = z.infer<
  typeof verifactuInvoiceSubmitRequestedV1
>;
