import { Prisma } from '@pms/db';

/**
 * Snapshot mínimo de una FolioEntry para el cálculo de la factura.
 * No depende de Prisma para que el helper sea trivialmente testeable.
 */
export interface FolioEntrySnapshot {
  type: 'CHARGE' | 'PAYMENT' | 'DISCOUNT' | 'TAX' | 'ADJUSTMENT';
  description: string;
  amount: Prisma.Decimal | string | number;
}

export interface InvoiceTotals {
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  lines: InvoiceLine[];
}

export interface InvoiceLine {
  type: 'CHARGE' | 'DISCOUNT' | 'TAX' | 'ADJUSTMENT';
  description: string;
  amount: string;
}

/**
 * Calcula los totales de la factura a partir de las entries del folio.
 *
 * Convención del folio (ver FolioService): CHARGE/TAX son positivos,
 * PAYMENT/DISCOUNT son negativos. La suma de todas las entries es 0 cuando
 * el folio se cierra.
 *
 * Para la factura:
 *  - subtotal     = sum(CHARGE) + sum(DISCOUNT) + sum(ADJUSTMENT)  (base imponible)
 *  - taxAmount    = sum(TAX)
 *  - totalAmount  = subtotal + taxAmount
 *  - lines        = todas las entries excepto PAYMENT (la factura es la
 *                   minuta, no el recibo).
 */
export function computeInvoiceTotals(entries: FolioEntrySnapshot[]): InvoiceTotals {
  const zero = new Prisma.Decimal(0);

  let subtotal = zero;
  let taxAmount = zero;
  const lines: InvoiceLine[] = [];

  for (const e of entries) {
    const amount = new Prisma.Decimal(e.amount);
    switch (e.type) {
      case 'CHARGE':
      case 'DISCOUNT':
      case 'ADJUSTMENT':
        subtotal = subtotal.add(amount);
        lines.push({ type: e.type, description: e.description, amount: amount.toFixed(2) });
        break;
      case 'TAX':
        taxAmount = taxAmount.add(amount);
        lines.push({ type: 'TAX', description: e.description, amount: amount.toFixed(2) });
        break;
      case 'PAYMENT':
        // No entra en la factura: la factura es la minuta, el pago es el recibo.
        break;
    }
  }

  return {
    subtotal,
    taxAmount,
    totalAmount: subtotal.add(taxAmount),
    lines,
  };
}
