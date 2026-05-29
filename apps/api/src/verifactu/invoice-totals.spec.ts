import { describe, expect, it } from 'vitest';
import { computeInvoiceTotals } from './invoice-totals';

describe('computeInvoiceTotals', () => {
  it('returns zeros for an empty folio', () => {
    const r = computeInvoiceTotals([]);
    expect(r.subtotal.toFixed(2)).toBe('0.00');
    expect(r.taxAmount.toFixed(2)).toBe('0.00');
    expect(r.totalAmount.toFixed(2)).toBe('0.00');
    expect(r.lines).toEqual([]);
  });

  it('sums charges + tax and excludes payment', () => {
    const r = computeInvoiceTotals([
      { type: 'CHARGE', description: 'Room night 1', amount: '100.00' },
      { type: 'TAX', description: 'IVA 10%', amount: '10.00' },
      { type: 'PAYMENT', description: 'Card capture', amount: '-110.00' },
    ]);
    expect(r.subtotal.toFixed(2)).toBe('100.00');
    expect(r.taxAmount.toFixed(2)).toBe('10.00');
    expect(r.totalAmount.toFixed(2)).toBe('110.00');
    expect(r.lines).toHaveLength(2); // CHARGE + TAX, no PAYMENT
    expect(r.lines.map((l) => l.type)).toEqual(['CHARGE', 'TAX']);
  });

  it('subtracts discount (stored as negative) from subtotal', () => {
    const r = computeInvoiceTotals([
      { type: 'CHARGE', description: 'Room night 1', amount: '100.00' },
      { type: 'DISCOUNT', description: 'Loyalty 10%', amount: '-10.00' },
      { type: 'TAX', description: 'IVA 10%', amount: '9.00' },
      { type: 'PAYMENT', description: 'Cash', amount: '-99.00' },
    ]);
    expect(r.subtotal.toFixed(2)).toBe('90.00');
    expect(r.taxAmount.toFixed(2)).toBe('9.00');
    expect(r.totalAmount.toFixed(2)).toBe('99.00');
    expect(r.lines).toHaveLength(3);
  });

  it('counts ADJUSTMENT into subtotal', () => {
    const r = computeInvoiceTotals([
      { type: 'CHARGE', description: 'Bar', amount: '50.00' },
      { type: 'ADJUSTMENT', description: 'Manual correction', amount: '-5.00' },
    ]);
    expect(r.subtotal.toFixed(2)).toBe('45.00');
  });
});
