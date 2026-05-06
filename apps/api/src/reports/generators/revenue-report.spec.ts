import { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { ReportContext } from '../types';
import { generateRevenueReport } from './revenue-report';

function buildCtx(rows: Array<{ type: string; sum: string; count: number }>) {
  const groupBy = vi.fn().mockResolvedValue(
    rows.map((r) => ({
      type: r.type,
      _sum: { amount: new Prisma.Decimal(r.sum) },
      _count: { _all: r.count },
    })),
  );
  const tx = {
    folioEntry: { groupBy },
  } as unknown as Prisma.TransactionClient;
  return { ctx: { tx, tenantId: 'tenant' } as ReportContext, groupBy };
}

describe('generateRevenueReport', () => {
  it('returns rows sorted by type and the grand total', async () => {
    const { ctx } = buildCtx([
      { type: 'PAYMENT', sum: '-200', count: 4 },
      { type: 'CHARGE', sum: '500', count: 10 },
      { type: 'TAX', sum: '50', count: 10 },
    ]);
    const out = await generateRevenueReport(ctx, {
      propertyId: 'p1',
      range: { from: '2026-06-01', to: '2026-06-30' },
    });
    expect(out.rows.map((r) => r.type)).toEqual(['CHARGE', 'PAYMENT', 'TAX']);
    expect(out.totalAmount).toBe('350');
    expect(out.range).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('returns empty rows + zero total when no entries match', async () => {
    const { ctx } = buildCtx([]);
    const out = await generateRevenueReport(ctx, {
      propertyId: 'p1',
      range: { from: '2026-06-01', to: '2026-06-30' },
    });
    expect(out.rows).toEqual([]);
    expect(out.totalAmount).toBe('0');
  });
});
