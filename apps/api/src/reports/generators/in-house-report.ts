import { ReservationStatus } from '@pms/db';
import type { InHouseReportPayload, ReportContext } from '../types';

interface Args {
  propertyId: string;
  businessDate: string;
}

/**
 * In-house Report — every reservation occupying a room on the business
 * date. Includes the assigned room number, the primary guest and the
 * current folio balance so the front desk can reconcile in one pass.
 */
export async function generateInHouseReport(
  ctx: ReportContext,
  { propertyId, businessDate }: Args,
): Promise<InHouseReportPayload> {
  const businessDateAsDate = new Date(businessDate);

  const rows = await ctx.tx.reservation.findMany({
    where: {
      propertyId,
      deletedAt: null,
      status: ReservationStatus.CHECKED_IN,
      arrivalDate: { lte: businessDateAsDate },
      departureDate: { gt: businessDateAsDate },
    },
    select: {
      id: true,
      code: true,
      arrivalDate: true,
      departureDate: true,
      adults: true,
      children: true,
      currency: true,
      room: { select: { number: true } },
      folio: { select: { balance: true, currency: true } },
      guests: {
        where: { isPrimary: true },
        select: {
          guest: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ room: { number: 'asc' } }, { code: 'asc' }],
  });

  return {
    businessDate,
    count: rows.length,
    rows: rows.map((r) => {
      const primary = r.guests[0]?.guest;
      return {
        reservationId: r.id,
        code: r.code,
        arrivalDate: r.arrivalDate.toISOString().slice(0, 10),
        departureDate: r.departureDate.toISOString().slice(0, 10),
        roomNumber: r.room?.number ?? null,
        primaryGuest: primary ? `${primary.lastName}, ${primary.firstName}` : null,
        adults: r.adults,
        children: r.children,
        balance: r.folio?.balance.toString() ?? '0',
        currency: r.folio?.currency ?? r.currency,
      };
    }),
  };
}
