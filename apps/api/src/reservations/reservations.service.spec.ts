import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ReservationSource,
  ReservationStatus,
} from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { ReservationsService } from './reservations.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const ROOM_TYPE_ID = '44444444-4444-4444-4444-444444444444';
const RATE_PLAN_ID = '55555555-5555-5555-5555-555555555555';
const GUEST_ID = '66666666-6666-6666-6666-666666666666';
const RESERVATION_ID = '77777777-7777-7777-7777-777777777777';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};

function buildService(overrides: {
  property?: { id: string; code: string; currency: string } | null;
  roomType?: { id: string } | null;
  ratePlan?: { id: string } | null;
  reservationOnFind?: {
    id: string;
    status: ReservationStatus;
    propertyId: string;
    code: string;
  } | null;
}) {
  const propertyFindFirst = vi.fn().mockResolvedValue(overrides.property ?? null);
  const roomTypeFindFirst = vi.fn().mockResolvedValue(overrides.roomType ?? null);
  const ratePlanFindFirst = vi.fn().mockResolvedValue(overrides.ratePlan ?? null);
  const reservationCreate = vi.fn().mockResolvedValue({
    id: RESERVATION_ID,
    propertyId: PROPERTY_ID,
    code: 'BCN-ABCDEF',
    totalAmount: new Prisma.Decimal(0),
    currency: 'EUR',
    checkedInAt: null,
  });
  const reservationFindFirst = vi
    .fn()
    .mockResolvedValue(overrides.reservationOnFind ?? null);
  const reservationUpdate = vi.fn().mockResolvedValue({
    id: RESERVATION_ID,
    propertyId: PROPERTY_ID,
    code: 'BCN-ABCDEF',
    cancelledAt: new Date('2026-06-10T10:00:00Z'),
  });
  const guestCreate = vi.fn().mockResolvedValue({ id: GUEST_ID });

  const tx = {
    property: { findFirst: propertyFindFirst },
    roomType: { findFirst: roomTypeFindFirst },
    ratePlan: { findFirst: ratePlanFindFirst },
    reservation: {
      create: reservationCreate,
      findFirst: reservationFindFirst,
      update: reservationUpdate,
    },
    guest: { create: guestCreate },
  };

  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };

  const service = new ReservationsService(
    prisma as never,
    events as never,
  );

  return { service, tx, prisma, events, calls: { reservationUpdate } };
}

describe('ReservationsService.create', () => {
  it('creates a PENDING reservation, an ad-hoc guest and emits reservation.created', async () => {
    const { service, events, tx } = buildService({
      property: { id: PROPERTY_ID, code: 'BCN', currency: 'EUR' },
      roomType: { id: ROOM_TYPE_ID },
      ratePlan: { id: RATE_PLAN_ID },
    });

    const result = await service.create(user, 'corr-1', {
      propertyId: PROPERTY_ID,
      guestData: { firstName: 'Ana', lastName: 'García' },
      arrival: '2026-06-10',
      departure: '2026-06-12',
      roomTypeId: ROOM_TYPE_ID,
      ratePlanId: RATE_PLAN_ID,
      occupancy: { adults: 2, children: 0 },
      currency: 'EUR',
      walkIn: false,
    });

    expect(result.id).toBe(RESERVATION_ID);
    expect(result.code).toMatch(/^BCN-[A-Z0-9]{6}$/);

    expect(tx.guest.create).toHaveBeenCalledOnce();
    const reservationCreateCall = tx.reservation.create.mock.calls[0]![0];
    expect(reservationCreateCall.data.status).toBe(ReservationStatus.PENDING);
    expect(reservationCreateCall.data.source).toBe(ReservationSource.DIRECT);
    expect(reservationCreateCall.data.checkedInAt).toBeNull();

    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('reservation.created');
  });

  it('walk-in goes straight to CHECKED_IN and emits both events', async () => {
    const { service, events, tx } = buildService({
      property: { id: PROPERTY_ID, code: 'BCN', currency: 'EUR' },
      roomType: { id: ROOM_TYPE_ID },
    });
    tx.reservation.create.mockResolvedValueOnce({
      id: RESERVATION_ID,
      propertyId: PROPERTY_ID,
      code: 'BCN-XYZ123',
      totalAmount: new Prisma.Decimal(0),
      currency: 'EUR',
      checkedInAt: new Date('2026-06-10T15:00:00Z'),
    });

    await service.createWalkIn(user, 'corr-2', {
      propertyId: PROPERTY_ID,
      guestData: { firstName: 'Walk', lastName: 'In' },
      arrival: '2026-06-10',
      departure: '2026-06-11',
      roomTypeId: ROOM_TYPE_ID,
      occupancy: { adults: 1, children: 0 },
      currency: 'EUR',
      walkIn: true,
    });

    const data = tx.reservation.create.mock.calls[0]![0].data;
    expect(data.status).toBe(ReservationStatus.CHECKED_IN);
    expect(data.source).toBe(ReservationSource.WALK_IN);
    expect(data.checkedInAt).toBeInstanceOf(Date);

    expect(events.publish).toHaveBeenCalledTimes(2);
    expect(events.publish.mock.calls[0]![0]).toBe('reservation.created');
    expect(events.publish.mock.calls[1]![0]).toBe('reservation.checked_in');
  });

  it('throws NotFoundException when property is missing', async () => {
    const { service } = buildService({ property: null });
    await expect(
      service.create(user, 'corr-3', {
        propertyId: PROPERTY_ID,
        guestData: { firstName: 'Ana', lastName: 'X' },
        arrival: '2026-06-10',
        departure: '2026-06-12',
        roomTypeId: ROOM_TYPE_ID,
        occupancy: { adults: 1, children: 0 },
        currency: 'EUR',
        walkIn: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReservationsService.cancel', () => {
  it('cancels a PENDING reservation and emits reservation.cancelled', async () => {
    const { service, events, calls } = buildService({
      reservationOnFind: {
        id: RESERVATION_ID,
        status: ReservationStatus.PENDING,
        propertyId: PROPERTY_ID,
        code: 'BCN-ABCDEF',
      },
    });

    const out = await service.cancel(user, 'corr-cancel', RESERVATION_ID, {
      reason: 'guest changed plans',
    });

    expect(out).toEqual({ id: RESERVATION_ID });
    expect(calls.reservationUpdate).toHaveBeenCalledOnce();
    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('reservation.cancelled');
  });

  it('throws ConflictException when reservation is already CHECKED_OUT', async () => {
    const { service } = buildService({
      reservationOnFind: {
        id: RESERVATION_ID,
        status: ReservationStatus.CHECKED_OUT,
        propertyId: PROPERTY_ID,
        code: 'BCN-ABCDEF',
      },
    });
    await expect(
      service.cancel(user, 'corr-cancel', RESERVATION_ID, { reason: 'oops' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when reservation does not exist', async () => {
    const { service } = buildService({ reservationOnFind: null });
    await expect(
      service.cancel(user, 'corr-cancel', RESERVATION_ID, { reason: 'oops' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
