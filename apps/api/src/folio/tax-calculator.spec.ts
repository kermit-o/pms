import { Prisma } from '@pms/db';
import { describe, expect, it } from 'vitest';
import {
  breakdownFromGross,
  breakdownFromNet,
  computeCityTax,
  type CityTaxRuleInput,
} from './tax-calculator';

// Helper para comparar Decimals como string (suficientemente legible).
const s = (d: Prisma.Decimal): string => d.toFixed(2);

describe('TaxCalculator.breakdownFromGross', () => {
  it('desglosa 110€ con IVA 10% → 100 / 10 / 110', () => {
    const r = breakdownFromGross({ gross: 110, taxRate: 10 });
    expect(s(r.net)).toBe('100.00');
    expect(s(r.tax)).toBe('10.00');
    expect(s(r.gross)).toBe('110.00');
  });

  it('desglosa 121€ con IVA 21% → 100 / 21 / 121', () => {
    const r = breakdownFromGross({ gross: 121, taxRate: 21 });
    expect(s(r.net)).toBe('100.00');
    expect(s(r.tax)).toBe('21.00');
    expect(s(r.gross)).toBe('121.00');
  });

  it('desglosa 104€ con IVA 4% → 100 / 4 / 104 (tipo superreducido)', () => {
    const r = breakdownFromGross({ gross: 104, taxRate: 4 });
    expect(s(r.net)).toBe('100.00');
    expect(s(r.tax)).toBe('4.00');
    expect(s(r.gross)).toBe('104.00');
  });

  it('desglosa 50€ exento (0%) → 50 / 0 / 50', () => {
    const r = breakdownFromGross({ gross: 50, taxRate: 0 });
    expect(s(r.net)).toBe('50.00');
    expect(s(r.tax)).toBe('0.00');
    expect(s(r.gross)).toBe('50.00');
  });

  it('preserva la suma exacta cuando hay redondeo (90€ 10% real)', () => {
    // 90 / 1.10 = 81.8181... → redondea a 81.82. tax = 90 - 81.82 = 8.18.
    const r = breakdownFromGross({ gross: 90, taxRate: 10 });
    expect(s(r.net)).toBe('81.82');
    expect(s(r.tax)).toBe('8.18');
    expect(s(r.gross)).toBe('90.00');
    expect(r.net.plus(r.tax).equals(r.gross)).toBe(true);
  });

  it('half-up sobre el .005 (89.99 / 1.10 ≈ 81.8090909 → 81.81)', () => {
    const r = breakdownFromGross({ gross: 89.99, taxRate: 10 });
    expect(s(r.net)).toBe('81.81');
    expect(s(r.tax)).toBe('8.18');
    expect(r.net.plus(r.tax).equals(r.gross)).toBe(true);
  });

  it('acepta string como input', () => {
    const r = breakdownFromGross({ gross: '121.50', taxRate: '21' });
    expect(s(r.net)).toBe('100.41');
    expect(s(r.gross)).toBe('121.50');
  });

  it('acepta Prisma.Decimal como input', () => {
    const r = breakdownFromGross({
      gross: new Prisma.Decimal('110'),
      taxRate: new Prisma.Decimal('10'),
    });
    expect(s(r.net)).toBe('100.00');
  });

  it('rechaza gross negativo', () => {
    expect(() => breakdownFromGross({ gross: -10, taxRate: 10 })).toThrow(/gross must be >= 0/);
  });

  it('rechaza taxRate fuera de [0, 100]', () => {
    expect(() => breakdownFromGross({ gross: 100, taxRate: -1 })).toThrow(/taxRate must be in/);
    expect(() => breakdownFromGross({ gross: 100, taxRate: 101 })).toThrow(/taxRate must be in/);
  });

  it('gross = 0 → todo ceros', () => {
    const r = breakdownFromGross({ gross: 0, taxRate: 10 });
    expect(s(r.net)).toBe('0.00');
    expect(s(r.tax)).toBe('0.00');
  });
});

describe('TaxCalculator.breakdownFromNet', () => {
  it('100€ neto + 10% → 100 / 10 / 110', () => {
    const r = breakdownFromNet({ net: 100, taxRate: 10 });
    expect(s(r.net)).toBe('100.00');
    expect(s(r.tax)).toBe('10.00');
    expect(s(r.gross)).toBe('110.00');
  });

  it('100€ neto + 21% → 100 / 21 / 121', () => {
    const r = breakdownFromNet({ net: 100, taxRate: 21 });
    expect(s(r.gross)).toBe('121.00');
  });

  it('redondeo half-up: 99.99 neto + 10% → 99.99 / 10.00 / 109.99', () => {
    // 99.99 × 0.10 = 9.999 → half-up = 10.00
    const r = breakdownFromNet({ net: 99.99, taxRate: 10 });
    expect(s(r.tax)).toBe('10.00');
    expect(s(r.gross)).toBe('109.99');
  });

  it('exento (0%) preserva neto y bruto', () => {
    const r = breakdownFromNet({ net: 75, taxRate: 0 });
    expect(s(r.net)).toBe('75.00');
    expect(s(r.tax)).toBe('0.00');
    expect(s(r.gross)).toBe('75.00');
  });

  it('rechaza net negativo', () => {
    expect(() => breakdownFromNet({ net: -1, taxRate: 10 })).toThrow(/net must be >= 0/);
  });

  it('rechaza taxRate fuera de [0, 100]', () => {
    expect(() => breakdownFromNet({ net: 100, taxRate: 150 })).toThrow(/taxRate must be in/);
  });
});

describe('TaxCalculator — composición gross↔net', () => {
  it('breakdownFromNet(100, 10) tiene los mismos campos que breakdownFromGross(110, 10)', () => {
    const a = breakdownFromNet({ net: 100, taxRate: 10 });
    const b = breakdownFromGross({ gross: 110, taxRate: 10 });
    expect(s(a.net)).toBe(s(b.net));
    expect(s(a.tax)).toBe(s(b.tax));
    expect(s(a.gross)).toBe(s(b.gross));
  });
});

describe('TaxCalculator.computeCityTax', () => {
  const CAT_TAX: CityTaxRuleInput = {
    amountPerNight: '1.20',
    appliesToAdults: true,
    appliesToChildren: false,
    childAgeThreshold: 16,
    maxNights: 7,
  };

  it('2 adultos × 3 noches × 1.20€ = 7.20€', () => {
    const r = computeCityTax({
      rule: CAT_TAX,
      adults: 2,
      children: [],
      nights: 3,
    });
    expect(r.chargeablePax).toBe(2);
    expect(r.effectiveNights).toBe(3);
    expect(s(r.perNight)).toBe('2.40');
    expect(s(r.total)).toBe('7.20');
  });

  it('aplica cap de 7 noches en estancia de 10 noches', () => {
    const r = computeCityTax({
      rule: CAT_TAX,
      adults: 2,
      children: [],
      nights: 10,
    });
    expect(r.effectiveNights).toBe(7);
    expect(s(r.total)).toBe('16.80'); // 2 × 1.20 × 7
  });

  it('niños no cobran cuando appliesToChildren=false', () => {
    const r = computeCityTax({
      rule: CAT_TAX,
      adults: 2,
      children: [{ age: 8 }, { age: 14 }],
      nights: 2,
    });
    expect(r.chargeablePax).toBe(2);
    expect(s(r.total)).toBe('4.80');
  });

  it('niños cobran cuando appliesToChildren=true y edad >= threshold (16)', () => {
    const rule = { ...CAT_TAX, appliesToChildren: true, childAgeThreshold: 16 };
    const r = computeCityTax({
      rule,
      adults: 2,
      children: [{ age: 17 }, { age: 14 }, { age: 16 }],
      nights: 1,
    });
    expect(r.chargeablePax).toBe(2 + 2); // 17 y 16 cobran, 14 no
    expect(s(r.total)).toBe('4.80');
  });

  it('appliesToAdults=false → solo niños cobrables', () => {
    const rule = {
      ...CAT_TAX,
      appliesToAdults: false,
      appliesToChildren: true,
      childAgeThreshold: 12,
    };
    const r = computeCityTax({
      rule,
      adults: 5,
      children: [{ age: 13 }],
      nights: 2,
    });
    expect(r.chargeablePax).toBe(1);
    expect(s(r.total)).toBe('2.40');
  });

  it('nights = 0 → total 0 sin importar pax', () => {
    const r = computeCityTax({
      rule: CAT_TAX,
      adults: 10,
      children: [],
      nights: 0,
    });
    expect(r.effectiveNights).toBe(0);
    expect(s(r.total)).toBe('0.00');
  });

  it('chargeablePax = 0 → total 0', () => {
    const r = computeCityTax({
      rule: CAT_TAX,
      adults: 0,
      children: [{ age: 5 }],
      nights: 3,
    });
    expect(s(r.perNight)).toBe('0.00');
    expect(s(r.total)).toBe('0.00');
  });

  it('maxNights = 0 se trata como sin cap', () => {
    const rule = { ...CAT_TAX, maxNights: 0 };
    const r = computeCityTax({
      rule,
      adults: 2,
      children: [],
      nights: 30,
    });
    expect(r.effectiveNights).toBe(30);
    expect(s(r.total)).toBe('72.00');
  });

  it('amountPerNight = 0 (region sin city tax) → 0', () => {
    const rule: CityTaxRuleInput = {
      amountPerNight: '0',
      appliesToAdults: true,
      appliesToChildren: false,
      childAgeThreshold: 16,
      maxNights: 7,
    };
    const r = computeCityTax({
      rule,
      adults: 4,
      children: [],
      nights: 5,
    });
    expect(s(r.total)).toBe('0.00');
  });

  it('rechaza adults negativo', () => {
    expect(() =>
      computeCityTax({ rule: CAT_TAX, adults: -1, children: [], nights: 1 }),
    ).toThrow(/adults must be >= 0/);
  });

  it('rechaza nights negativo', () => {
    expect(() =>
      computeCityTax({ rule: CAT_TAX, adults: 1, children: [], nights: -1 }),
    ).toThrow(/nights must be >= 0/);
  });

  it('rechaza amountPerNight negativo', () => {
    const rule = { ...CAT_TAX, amountPerNight: '-1' };
    expect(() => computeCityTax({ rule, adults: 1, children: [], nights: 1 })).toThrow(
      /amountPerNight must be >= 0/,
    );
  });

  it('redondeo half-up sobre amounts no enteros (Baleares 2.20€ × 3 pax × 4 noches)', () => {
    const rule: CityTaxRuleInput = {
      amountPerNight: '2.20',
      appliesToAdults: true,
      appliesToChildren: false,
      childAgeThreshold: 16,
      maxNights: 9,
    };
    const r = computeCityTax({
      rule,
      adults: 3,
      children: [],
      nights: 4,
    });
    expect(s(r.perNight)).toBe('6.60');
    expect(s(r.total)).toBe('26.40');
  });
});
