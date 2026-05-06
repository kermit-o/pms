import { Prisma, ReservationStatus } from '@pms/db';
import type { ManagerReportPayload, ReportContext } from '../types';

interface Args {
  propertyId: string;
  businessDate: string;
}

/**
 * Manager Report — operational KPIs for one business date.
 *
 * Pulls in-house / arrivals / departures from `reservation`, occupancy from
 * `room`, and revenue totals from `folio_entries` posted that calendar day
 * (CHARGE + TAX entries; PAYMENTs are negative and excluded so the figure is
 * "guest-owes" rather than "cash collected").
 *
 * ADR = totalRoomCharges / inHouse  (0 when inHouse=0).
 * RevPAR = totalRoomCharges / totalRooms  (0 when totalRooms=0).
 */
export async function generateManagerReport(
  ctx: ReportContext,
  { propertyId, businessDate }: Args,
): Promise<ManagerReportPayload> {
  const businessDateAsDate = new Date(businessDate);
  const dayStart = startOfUtcDay(businessDateAsDate);
  const dayEnd = endOfUtcDay(businessDateAsDate);

  const [inHouse, arrivals, departures, cancellationsToday, totalRooms, charges, roomCharges] =
    await Promise.all([
      ctx.tx.reservation.count({
        where: {
          propertyId,
          deletedAt: null,
          status: ReservationStatus.CHECKED_IN,
          arrivalDate: { lte: businessDateAsDate },
          departureDate: { gt: businessDateAsDate },
        },
      }),
      ctx.tx.reservation.count({
        where: { propertyId, deletedAt: null, arrivalDate: businessDateAsDate },
      }),
      ctx.tx.reservation.count({
        where: { propertyId, deletedAt: null, departureDate: businessDateAsDate },
      }),
      ctx.tx.reservation.count({
        where: {
          propertyId,
          deletedAt: null,
          status: ReservationStatus.CANCELLED,
          cancelledAt: { gte: dayStart, lt: dayEnd },
        },
      }),
      ctx.tx.room.count({ where: { propertyId, deletedAt: null } }),
      ctx.tx.folioEntry.aggregate({
        where: {
          tenantId: ctx.tenantId,
          type: { in: ['CHARGE', 'TAX'] },
          postedAt: { gte: dayStart, lt: dayEnd },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      ctx.tx.folioEntry.aggregate({
        where: {
          tenantId: ctx.tenantId,
          type: 'CHARGE',
          idempotencyKey: { startsWith: `na:room:${businessDate}:` },
        },
        _sum: { amount: true },
      }),
    ]);

  const occupancyPct = totalRooms === 0 ? 0 : Math.round((inHouse / totalRooms) * 10000) / 10000;

  const roomChargeTotal = roomCharges._sum.amount
    ? new Prisma.Decimal(roomCharges._sum.amount)
    : new Prisma.Decimal(0);
  const adr =
    inHouse === 0 ? '0' : roomChargeTotal.dividedBy(inHouse).toDecimalPlaces(2).toString();
  const revpar =
    totalRooms === 0 ? '0' : roomChargeTotal.dividedBy(totalRooms).toDecimalPlaces(2).toString();

  return {
    businessDate,
    totalRooms,
    inHouse,
    arrivals,
    departures,
    cancellationsToday,
    occupancyPct,
    adr,
    revpar,
    charges: {
      count: charges._count._all,
      totalAmount: charges._sum.amount?.toString() ?? '0',
    },
  };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}
