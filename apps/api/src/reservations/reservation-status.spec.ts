import { describe, expect, it } from 'vitest';
import {
  IllegalReservationTransitionError,
  ReservationStatus,
  assertTransition,
  canTransition,
} from './reservation-status';

describe('reservation state machine', () => {
  it('allows PENDING -> CONFIRMED', () => {
    expect(canTransition(ReservationStatus.PENDING, ReservationStatus.CONFIRMED)).toBe(true);
  });

  it('allows CONFIRMED -> CHECKED_IN', () => {
    expect(canTransition(ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN)).toBe(true);
  });

  it('allows CHECKED_IN -> CHECKED_OUT', () => {
    expect(canTransition(ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT)).toBe(true);
  });

  it('rejects CHECKED_OUT -> anything', () => {
    expect(canTransition(ReservationStatus.CHECKED_OUT, ReservationStatus.CHECKED_IN)).toBe(false);
    expect(canTransition(ReservationStatus.CHECKED_OUT, ReservationStatus.CANCELLED)).toBe(false);
  });

  it('rejects CANCELLED -> anything', () => {
    expect(canTransition(ReservationStatus.CANCELLED, ReservationStatus.CHECKED_IN)).toBe(false);
  });

  it('rejects PENDING -> CHECKED_OUT (must go through CHECKED_IN)', () => {
    expect(canTransition(ReservationStatus.PENDING, ReservationStatus.CHECKED_OUT)).toBe(false);
  });

  it('assertTransition throws on illegal transition', () => {
    expect(() =>
      assertTransition(ReservationStatus.CHECKED_OUT, ReservationStatus.CHECKED_IN),
    ).toThrowError(IllegalReservationTransitionError);
  });
});
