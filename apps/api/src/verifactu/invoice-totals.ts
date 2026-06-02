import { Prisma } from '@pms/db';

/**
 * Snapshot mínimo de una FolioEntry para el cálculo de la factura.
 * No depende de Prisma para que el helper sea trivialmente testeable.
 *
 * Tras RFC-001 los entries pueden traer desglose fiscal (netAmount,
 * taxRate, taxAmount, taxCategory). Los entries legacy quedan con
 * estos campos en `null` y se tratan como antes (charge plano).
 */
export interface FolioEntrySnapshot {
  type: 'CHARGE' | 'PAYMENT' | 'DISCOUNT' | 'TAX' | 'ADJUSTMENT';
  description: string;
  amount: Prisma.Decimal | string | number;
  netAmount?: Prisma.Decimal | string | number | null;
  taxRate?: Prisma.Decimal | string | number | null;
  taxAmount?: Prisma.Decimal | string | number | null;
  taxCategory?:
    | 'ROOM'
    | 'BREAKFAST'
    | 'EXTRA_FOOD'
    | 'EXTRA_OTHER'
    | 'CITY_TAX'
    | 'EXEMPT'
    | null;
}

export interface InvoiceTotals {
  /** Base imponible total (sin contar city tax). */
  subtotal: Prisma.Decimal;
  /** Cuota IVA total (suma de cuotas por línea o legacy TAX). */
  taxAmount: Prisma.Decimal;
  /** City tax (NoSujeta, ADR-033). 0 si no aplica. */
  cityTaxAmount: Prisma.Decimal;
  /** subtotal + taxAmount + cityTaxAmount. */
  totalAmount: Prisma.Decimal;
  /** Líneas con campos fiscales preservados (entran al JSONB invoice.lines). */
  lines: InvoiceLine[];
  /**
   * Desglose por tipo IVA — una entrada por taxRate distinto presente
   * en las líneas con breakdown. Excluye CITY_TAX (va en cityTaxAmount).
   * El XML AEAT emite un <DetalleDesglose> por cada entrada.
   */
  breakdownByRate: TaxRateBreakdown[];
}

export interface TaxRateBreakdown {
  /** "10", "21", "4", "0" (string para preservar precisión). */
  taxRate: string;
  /** Suma de bases imponibles a este tipo. */
  base: Prisma.Decimal;
  /** Suma de cuotas a este tipo. */
  tax: Prisma.Decimal;
}

export interface InvoiceLine {
  type: 'CHARGE' | 'DISCOUNT' | 'TAX' | 'ADJUSTMENT';
  description: string;
  amount: string;
  netAmount?: string;
  taxRate?: string;
  taxAmount?: string;
  taxCategory?: string;
}

/**
 * Calcula los totales de la factura a partir de las entries del folio.
 *
 * Reglas (RFC-001 §3.6):
 *  - CITY_TAX → cityTaxAmount (NoSujeta, no IVA repercutido).
 *  - Entry con breakdown (netAmount + taxRate + taxAmount):
 *      subtotal += netAmount
 *      taxAmount += taxAmount
 *      breakdownByRate[taxRate].base += netAmount
 *      breakdownByRate[taxRate].tax += taxAmount
 *  - Entry legacy TAX (sin breakdown): taxAmount += amount.
 *  - Entry legacy CHARGE/DISCOUNT/ADJUSTMENT (sin breakdown): subtotal += amount.
 *  - PAYMENT: no entra (la factura es la minuta, no el recibo).
 *
 * totalAmount = subtotal + taxAmount + cityTaxAmount.
 */
export function computeInvoiceTotals(entries: FolioEntrySnapshot[]): InvoiceTotals {
  const zero = new Prisma.Decimal(0);
  let subtotal = zero;
  let taxAmount = zero;
  let cityTaxAmount = zero;
  const lines: InvoiceLine[] = [];
  const breakdownMap = new Map<string, { base: Prisma.Decimal; tax: Prisma.Decimal }>();

  for (const e of entries) {
    if (e.type === 'PAYMENT') continue;

    const amount = new Prisma.Decimal(e.amount);
    const hasBreakdown =
      e.netAmount != null && e.taxAmount != null && e.taxRate != null;
    const isCityTax = e.taxCategory === 'CITY_TAX';

    if (isCityTax) {
      cityTaxAmount = cityTaxAmount.add(amount);
      lines.push({
        type: e.type as InvoiceLine['type'],
        description: e.description,
        amount: amount.toFixed(2),
        ...(hasBreakdown
          ? {
              netAmount: new Prisma.Decimal(e.netAmount!).toFixed(2),
              taxRate: new Prisma.Decimal(e.taxRate!).toFixed(2),
              taxAmount: new Prisma.Decimal(e.taxAmount!).toFixed(2),
              taxCategory: e.taxCategory ?? undefined,
            }
          : { taxCategory: 'CITY_TAX' }),
      });
      continue;
    }

    if (hasBreakdown) {
      const net = new Prisma.Decimal(e.netAmount!);
      const tax = new Prisma.Decimal(e.taxAmount!);
      const rateKey = new Prisma.Decimal(e.taxRate!).toFixed(2);
      subtotal = subtotal.add(net);
      taxAmount = taxAmount.add(tax);
      const prev = breakdownMap.get(rateKey) ?? { base: zero, tax: zero };
      breakdownMap.set(rateKey, {
        base: prev.base.add(net),
        tax: prev.tax.add(tax),
      });
      lines.push({
        type: e.type as InvoiceLine['type'],
        description: e.description,
        amount: amount.toFixed(2),
        netAmount: net.toFixed(2),
        taxRate: rateKey,
        taxAmount: tax.toFixed(2),
        taxCategory: e.taxCategory ?? undefined,
      });
      continue;
    }

    // Legacy: sin breakdown.
    if (e.type === 'TAX') {
      taxAmount = taxAmount.add(amount);
      lines.push({ type: 'TAX', description: e.description, amount: amount.toFixed(2) });
    } else {
      subtotal = subtotal.add(amount);
      lines.push({
        type: e.type as InvoiceLine['type'],
        description: e.description,
        amount: amount.toFixed(2),
      });
    }
  }

  const breakdownByRate: TaxRateBreakdown[] = Array.from(breakdownMap.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rateKey, v]) => ({
      taxRate: rateKey,
      base: v.base,
      tax: v.tax,
    }));

  return {
    subtotal,
    taxAmount,
    cityTaxAmount,
    totalAmount: subtotal.add(taxAmount).add(cityTaxAmount),
    lines,
    breakdownByRate,
  };
}
