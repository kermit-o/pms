import type { Prisma } from '@pms/db';
import type {
  ArrivalsDeparturesReportPayload,
  ArrivalsDeparturesRow,
  ReportContext,
} from '../types';

interface Args {
  propertyId: string;
  businessDate: string;
}

/**
 * Arrivals / Departures Report — two lists of reservations for a single
 * day. "Arrivals" includes any reservation whose arrival is the business
 * date (regardless of status — PENDING walk-ins, CONFIRMED bookings,
 * already CHECKED_IN, NO_SHOW). "Departures" works the same way over
 * departureDate. CANCELLED reservations are excluded from both lists.
 */
export async function generateArrivalsDeparturesReport(
  ctx: ReportContext,
  { propertyId, businessDate }: Args,
): Promise<ArrivalsDeparturesReportPayload> {
  const businessDateAsDate = new Date(businessDate);

  const [arrivals, departures] = await Promise.all([
    fetchRows(ctx, {
      propertyId,
      where: { arrivalDate: businessDateAsDate },
    }),
    fetchRows(ctx, {
      propertyId,
      where: { departureDate: businessDateAsDate },
    }),
  ]);

  return {
    businessDate,
    arrivals,
    departures,
  };
}

async function fetchRows(
  ctx: ReportContext,
  args: {
    propertyId: string;
    where: Prisma.ReservationWhereInput;
  },
): Promise<ArrivalsDeparturesRow[]> {
  const rows = await ctx.tx.reservation.findMany({
    where: {
      propertyId: args.propertyId,
      deletedAt: null,
      status: { not: 'CANCELLED' },
      ...args.where,
    },
    select: {
      id: true,
      code: true,
      status: true,
      arrivalDate: true,
      departureDate: true,
      room: { select: { number: true } },
      guests: {
        where: { isPrimary: true },
        select: {
          guest: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ code: 'asc' }],
  });

  return rows.map((r) => {
    const primary = r.guests[0]?.guest;
    return {
      reservationId: r.id,
      code: r.code,
      status: r.status,
      arrivalDate: r.arrivalDate.toISOString().slice(0, 10),
      departureDate: r.departureDate.toISOString().slice(0, 10),
      roomNumber: r.room?.number ?? null,
      primaryGuest: primary ? `${primary.lastName}, ${primary.firstName}` : null,
    };
  });
}
