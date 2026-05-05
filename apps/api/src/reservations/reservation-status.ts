/**
 * Reservation lifecycle states.
 * Mirrors the Prisma enum but kept here so the service layer can validate
 * transitions without a runtime dependency on `@prisma/client` enums.
 */
export const ReservationStatus = {
  BOOKED: 'BOOKED',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;

export type ReservationStatus =
  (typeof ReservationStatus)[keyof typeof ReservationStatus];

const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  BOOKED: ['CONFIRMED', 'CANCELLED', 'NO_SHOW', 'CHECKED_IN'],
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
