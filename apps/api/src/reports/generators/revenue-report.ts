import { Prisma } from '@pms/db';
import type { DateRange, ReportContext, RevenueReportPayload } from '../types';

interface Args {
  propertyId: string;
  range: DateRange;
}

/**
 * Revenue Report — folio entries grouped by `type` over a date range.
 *
 * Window is inclusive on both ends. Returns one row per FolioEntryType with
 * count + summed amount (preserving sign — payments will appear as negative).
 * The grand total mirrors the operating cash impact for the range.
 */
export async function generateRevenueReport(
  ctx: ReportContext,
  { propertyId, range }: Args,
): Promise<RevenueReportPayload> {
  const fromDate = startOfUtcDay(new Date(range.from));
  const toDate = endOfUtcDay(new Date(range.to));

  // FolioEntry rows are scoped via folio.reservation.propertyId — fetch the
  // entries with a join filter to keep a single query under RLS.
  const grouped = await ctx.tx.folioEntry.groupBy({
    by: ['type'],
    where: {
      tenantId: ctx.tenantId,
      postedAt: { gte: fromDate, lt: toDate },
      folio: { reservation: { propertyId } },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const rows = grouped
    .map((g) => ({
      type: g.type,
      count: g._count._all,
      totalAmount: g._sum.amount?.toString() ?? '0',
    }))
    .sort((a, b) => a.type.localeCompare(b.type));

  const total = grouped.reduce(
    (acc, g) => (g._sum.amount ? acc.plus(new Prisma.Decimal(g._sum.amount)) : acc),
    new Prisma.Decimal(0),
  );

  return {
    range,
    rows,
    totalAmount: total.toString(),
  };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}
