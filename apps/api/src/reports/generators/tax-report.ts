import { Prisma } from '@pms/db';
import type { DateRange, ReportContext, TaxReportPayload } from '../types';

interface Args {
  propertyId: string;
  range: DateRange;
}

/**
 * Tax Report — TAX folio entries grouped by description over a range.
 *
 * The night-audit POST_TAXES step writes a description like
 *   "Tax 2026-06-10 (10%)"
 * so grouping by description naturally aggregates by rate (10%, 21%, …)
 * without requiring a dedicated taxRate column. Returns one row per unique
 * description plus the grand total.
 */
export async function generateTaxReport(
  ctx: ReportContext,
  { propertyId, range }: Args,
): Promise<TaxReportPayload> {
  const fromDate = startOfUtcDay(new Date(range.from));
  const toDate = endOfUtcDay(new Date(range.to));

  const grouped = await ctx.tx.folioEntry.groupBy({
    by: ['description'],
    where: {
      tenantId: ctx.tenantId,
      type: 'TAX',
      postedAt: { gte: fromDate, lt: toDate },
      folio: { reservation: { propertyId } },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const rows = grouped
    .map((g) => ({
      description: g.description,
      count: g._count._all,
      totalAmount: g._sum.amount?.toString() ?? '0',
    }))
    .sort((a, b) => a.description.localeCompare(b.description));

  const total = grouped.reduce(
    (acc, g) => (g._sum.amount ? acc.plus(new Prisma.Decimal(g._sum.amount)) : acc),
    new Prisma.Decimal(0),
  );

  return { range, rows, totalAmount: total.toString() };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}
