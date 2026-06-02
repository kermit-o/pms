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

  it('agrupa por taxRate cuando hay desglose (RFC-001)', () => {
    const r = computeInvoiceTotals([
      {
        type: 'CHARGE',
        description: 'Habitación',
        amount: '110.00',
        netAmount: '100.00',
        taxRate: '10.00',
        taxAmount: '10.00',
        taxCategory: 'ROOM',
      },
      {
        type: 'CHARGE',
        description: 'Parking',
        amount: '12.10',
        netAmount: '10.00',
        taxRate: '21.00',
        taxAmount: '2.10',
        taxCategory: 'EXTRA_OTHER',
      },
      {
        type: 'CHARGE',
        description: 'Desayuno',
        amount: '11.00',
        netAmount: '10.00',
        taxRate: '10.00',
        taxAmount: '1.00',
        taxCategory: 'BREAKFAST',
      },
    ]);
    expect(r.subtotal.toFixed(2)).toBe('120.00');
    expect(r.taxAmount.toFixed(2)).toBe('13.10');
    expect(r.cityTaxAmount.toFixed(2)).toBe('0.00');
    expect(r.totalAmount.toFixed(2)).toBe('133.10');
    expect(r.breakdownByRate).toHaveLength(2);
    const r10 = r.breakdownByRate.find((b) => b.taxRate === '10.00');
    expect(r10?.base.toFixed(2)).toBe('110.00');
    expect(r10?.tax.toFixed(2)).toBe('11.00');
    const r21 = r.breakdownByRate.find((b) => b.taxRate === '21.00');
    expect(r21?.base.toFixed(2)).toBe('10.00');
    expect(r21?.tax.toFixed(2)).toBe('2.10');
  });

  it('separa CITY_TAX en cityTaxAmount (no entra en subtotal ni breakdown)', () => {
    const r = computeInvoiceTotals([
      {
        type: 'CHARGE',
        description: 'Habitación',
        amount: '110.00',
        netAmount: '100.00',
        taxRate: '10.00',
        taxAmount: '10.00',
        taxCategory: 'ROOM',
      },
      {
        type: 'CHARGE',
        description: 'City tax 2 noches',
        amount: '4.80',
        netAmount: '4.80',
        taxRate: '0.00',
        taxAmount: '0.00',
        taxCategory: 'CITY_TAX',
      },
    ]);
    expect(r.subtotal.toFixed(2)).toBe('100.00');
    expect(r.taxAmount.toFixed(2)).toBe('10.00');
    expect(r.cityTaxAmount.toFixed(2)).toBe('4.80');
    expect(r.totalAmount.toFixed(2)).toBe('114.80');
    expect(r.breakdownByRate).toHaveLength(1);
    expect(r.breakdownByRate[0]!.taxRate).toBe('10.00');
  });

  it('mezcla entries legacy (sin breakdown) + con breakdown', () => {
    const r = computeInvoiceTotals([
      // Legacy: charge + TAX separados.
      { type: 'CHARGE', description: 'Bar legacy', amount: '50.00' },
      { type: 'TAX', description: 'IVA 21%', amount: '10.50' },
      // Nuevo: con breakdown.
      {
        type: 'CHARGE',
        description: 'Habitación',
        amount: '110.00',
        netAmount: '100.00',
        taxRate: '10.00',
        taxAmount: '10.00',
        taxCategory: 'ROOM',
      },
    ]);
    // subtotal: 50 (legacy) + 100 (breakdown net)
    expect(r.subtotal.toFixed(2)).toBe('150.00');
    expect(r.taxAmount.toFixed(2)).toBe('20.50');
    expect(r.totalAmount.toFixed(2)).toBe('170.50');
    // breakdownByRate sólo refleja los entries con desglose
    expect(r.breakdownByRate).toHaveLength(1);
    expect(r.breakdownByRate[0]!.taxRate).toBe('10.00');
  });
});
