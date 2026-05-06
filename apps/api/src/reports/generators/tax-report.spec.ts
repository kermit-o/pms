import { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { ReportContext } from '../types';
import { generateTaxReport } from './tax-report';

function buildCtx(rows: Array<{ description: string; sum: string; count: number }>) {
  const groupBy = vi.fn().mockResolvedValue(
    rows.map((r) => ({
      description: r.description,
      _sum: { amount: new Prisma.Decimal(r.sum) },
      _count: { _all: r.count },
    })),
  );
  const tx = {
    folioEntry: { groupBy },
  } as unknown as Prisma.TransactionClient;
  return { ctx: { tx, tenantId: 'tenant' } as ReportContext };
}

describe('generateTaxReport', () => {
  it('groups TAX entries by description and totals', async () => {
    const { ctx } = buildCtx([
      { description: 'Tax 2026-06-10 (10%)', sum: '50', count: 5 },
      { description: 'Tax 2026-06-10 (21%)', sum: '21', count: 1 },
    ]);
    const out = await generateTaxReport(ctx, {
      propertyId: 'p1',
      range: { from: '2026-06-10', to: '2026-06-10' },
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]!.description).toBe('Tax 2026-06-10 (10%)');
    expect(out.totalAmount).toBe('71');
  });

  it('handles empty result set', async () => {
    const { ctx } = buildCtx([]);
    const out = await generateTaxReport(ctx, {
      propertyId: 'p1',
      range: { from: '2026-06-10', to: '2026-06-10' },
    });
    expect(out.rows).toEqual([]);
    expect(out.totalAmount).toBe('0');
  });
});
