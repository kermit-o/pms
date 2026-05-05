import { ReservationStatus as PrismaReservationStatus } from '@pms/db';

/**
 * Reservation lifecycle states. Re-exports the Prisma enum so the service
 * layer can validate transitions without coupling to runtime Prisma symbols
 * everywhere.
 */
export const ReservationStatus = PrismaReservationStatus;
export type ReservationStatus =
  (typeof ReservationStatus)[keyof typeof ReservationStatus];

const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'NO_SHOW', 'CHECKED_IN'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalReservationTransitionError extends Error {
  constructor(
    public readonly from: ReservationStatus,
    public readonly to: ReservationStatus,
  ) {
    super(`Illegal reservation transition: ${from} -> ${to}`);
    this.name = 'IllegalReservationTransitionError';
  }
}

export function assertTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): void {
  if (!canTransition(from, to)) {
    throw new IllegalReservationTransitionError(from, to);
  }
}
