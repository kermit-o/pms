import { Prisma } from '@pms/db';
import { describe, expect, it } from 'vitest';
import { resolveDailyRate } from './pricing';

describe('resolveDailyRate', () => {
  it('returns defaultRate when ratePlan is null', () => {
    const out = resolveDailyRate(100, null);
    expect(out.toString()).toBe('100');
  });

  it('applies attributes.dailyRate as override', () => {
    const out = resolveDailyRate(100, {
      attributes: { dailyRate: 75 },
      discountPct: null,
    });
    expect(out.toString()).toBe('75');
  });

  it('applies discountPct over defaultRate', () => {
    const out = resolveDailyRate(100, {
      attributes: null,
      discountPct: new Prisma.Decimal(10),
    });
    expect(out.toString()).toBe('90');
  });

  it('applies discountPct over an attributes.dailyRate override', () => {
    const out = resolveDailyRate(100, {
      attributes: { dailyRate: 200 },
      discountPct: new Prisma.Decimal(25),
    });
    expect(out.toString()).toBe('150');
  });

  it('ignores discountPct of 0 or 100+', () => {
    expect(resolveDailyRate(100, { attributes: null, discountPct: 0 }).toString()).toBe('100');
    expect(resolveDailyRate(100, { attributes: null, discountPct: 150 }).toString()).toBe('100');
  });

  it('handles malformed attributes silently', () => {
    expect(
      resolveDailyRate(100, { attributes: { dailyRate: 'NaN' }, discountPct: null }).toString(),
    ).toBe('100');
    expect(
      resolveDailyRate(100, { attributes: 'string-not-object' as never, discountPct: null }).toString(),
    ).toBe('100');
  });
});
