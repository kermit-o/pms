import { ReservationStatus } from '@pms/db';
import type { DateRange, ReportContext } from '../types';

interface Args {
  propertyId: string;
  range: DateRange;
}

export interface OccupancyDayRow {
  /** YYYY-MM-DD */
  businessDate: string;
  /** Total habitaciones físicas no fuera-de-orden. */
  totalRooms: number;
  /** Reservas in-house esa fecha (arrival ≤ date < departure, CHECKED_IN). */
  occupied: number;
  /** Ratio 0..1, redondeado a 4 decimales. */
  occupancyPct: number;
}

export interface OccupancyReportPayload {
  range: DateRange;
  rows: OccupancyDayRow[];
  /** Promedio de `occupancyPct` sobre los días con `totalRooms > 0`. */
  averageOccupancyPct: number;
}

/**
 * Occupancy report — ocupación día a día para un rango.
 *
 * Sprint 12 W2. Sin snapshot dependency: recalcula sobre `reservations`
 * + `rooms` para que sirva tanto para fechas pasadas (post-NA) como
 * para forecast a corto plazo (próximos días).
 *
 * Algoritmo:
 *  - Para cada fecha del rango:
 *    - count rooms activas (no deleted, no OOO) → `totalRooms`.
 *    - count reservas con `status ∈ {CHECKED_IN, CONFIRMED}` y
 *      `arrival ≤ date < departure` → `occupied`.
 *    - `occupancyPct = occupied / totalRooms` (0 si no hay rooms).
 *
 * Decisión: usamos también CONFIRMED (no solo CHECKED_IN) para que la
 * vista cubra forecast. Si solo se quiere realizado, filtrar a
 * CHECKED_IN en post-procesamiento.
 */
export async function generateOccupancyReport(
  ctx: ReportContext,
  { propertyId, range }: Args,
): Promise<OccupancyReportPayload> {
  const days = enumerateDates(range.from, range.to);

  const totalRooms = await ctx.tx.room.count({
    where: {
      propertyId,
      deletedAt: null,
      isOutOfOrder: false,
    },
  });

  const rows: OccupancyDayRow[] = [];
  // Una query por día. Con horizontes pequeños (≤ 90 días) está bien;
  // si en el futuro lo extendemos a 365d, refactorizar a un único
  // groupBy con generate_series.
  for (const date of days) {
    const dateAsDate = new Date(date);
    const nextDay = new Date(dateAsDate.getTime() + 86_400_000);
    const occupied = await ctx.tx.reservation.count({
      where: {
        propertyId,
        deletedAt: null,
        status: { in: [ReservationStatus.CHECKED_IN, ReservationStatus.CONFIRMED] },
        arrivalDate: { lt: nextDay },
        departureDate: { gt: dateAsDate },
      },
    });
    const occupancyPct =
      totalRooms > 0 ? round4(occupied / totalRooms) : 0;
    rows.push({ businessDate: date, totalRooms, occupied, occupancyPct });
  }

  const validRows = rows.filter((r) => r.totalRooms > 0);
  const averageOccupancyPct =
    validRows.length > 0
      ? round4(
          validRows.reduce((acc, r) => acc + r.occupancyPct, 0) / validRows.length,
        )
      : 0;

  return { range, rows, averageOccupancyPct };
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  if (start > end) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
