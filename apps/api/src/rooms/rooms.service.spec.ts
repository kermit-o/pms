import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationStatus, RoomStatus } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { RoomsService } from './rooms.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const ROOM_TYPE_ID = '44444444-4444-4444-4444-444444444444';

const ROOM_A = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  number: '101',
  floor: '1',
  status: RoomStatus.CLEAN,
  isOutOfOrder: false,
  outOfOrderReason: null,
  roomTypeId: ROOM_TYPE_ID,
  propertyId: PROPERTY_ID,
};
const ROOM_B = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  number: '102',
  floor: '1',
  status: RoomStatus.DIRTY,
  isOutOfOrder: false,
  outOfOrderReason: null,
  roomTypeId: ROOM_TYPE_ID,
  propertyId: PROPERTY_ID,
};
const ROOM_C_OOO = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  number: '103',
  floor: '1',
  status: RoomStatus.OUT_OF_ORDER,
  isOutOfOrder: true,
  outOfOrderReason: 'broken AC',
  roomTypeId: ROOM_TYPE_ID,
  propertyId: PROPERTY_ID,
};

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};

type RoomFixture = {
  id: string;
  number: string;
  floor: string | null;
  status: RoomStatus;
  isOutOfOrder: boolean;
  outOfOrderReason: string | null;
  roomTypeId: string;
  propertyId: string;
};

function buildService(opts: {
  rooms?: RoomFixture[];
  reservations?: Array<{
    id: string;
    code: string;
    status: ReservationStatus;
    roomId: string | null;
    arrivalDate: Date;
    departureDate: Date;
  }>;
  roomFindFirst?: RoomFixture | null;
}) {
  const roomFindMany = vi.fn().mockResolvedValue(opts.rooms ?? []);
  const reservationFindMany = vi.fn().mockResolvedValue(opts.reservations ?? []);
  const roomFindFirst = vi.fn().mockResolvedValue(opts.roomFindFirst ?? null);
  const roomUpdate = vi.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      ...(opts.roomFindFirst ?? ROOM_A),
      ...data,
    }),
  );

  const tx = {
    room: {
      findMany: roomFindMany,
      findFirst: roomFindFirst,
      update: roomUpdate,
    },
    reservation: { findMany: reservationFindMany },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const service = new RoomsService(prisma as never, events as never);
  return { service, tx, events };
}

describe('RoomsService.availability', () => {
  it('builds a matrix with OCC for overlapping reservations', async () => {
    const { service } = buildService({
      rooms: [ROOM_A, ROOM_B],
      reservations: [
        {
          id: 'res-1',
          code: 'BCN-AAA',
          status: ReservationStatus.CONFIRMED,
          roomId: ROOM_A.id,
          arrivalDate: new Date('2026-06-10'),
          departureDate: new Date('2026-06-12'),
        },
      ],
    });

    const matrix = await service.availability(user, 'corr', {
      propertyId: PROPERTY_ID,
      from: '2026-06-09',
      to: '2026-06-13',
    });

    expect(matrix.days).toEqual(['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12']);
    expect(matrix.cells[ROOM_A.id]!['2026-06-09']!.state).toBe('CLEAN');
    expect(matrix.cells[ROOM_A.id]!['2026-06-10']!.state).toBe('OCC');
    expect(matrix.cells[ROOM_A.id]!['2026-06-11']!.state).toBe('OCC');
    expect(matrix.cells[ROOM_A.id]!['2026-06-12']!.state).toBe('CLEAN');
    expect(matrix.cells[ROOM_B.id]!['2026-06-10']!.state).toBe('DIRTY');
  });

  it('marks OOO rooms regardless of reservations', async () => {
    const { service } = buildService({
      rooms: [ROOM_C_OOO],
      reservations: [],
    });
    const matrix = await service.availability(user, 'corr', {
      propertyId: PROPERTY_ID,
      from: '2026-06-09',
      to: '2026-06-11',
    });
    expect(matrix.cells[ROOM_C_OOO.id]!['2026-06-09']!.state).toBe('OOO');
    expect(matrix.cells[ROOM_C_OOO.id]!['2026-06-10']!.state).toBe('OOO');
  });

  it('rejects invalid date range', async () => {
    const { service } = buildService({});
    await expect(
      service.availability(user, 'corr', {
        propertyId: PROPERTY_ID,
        from: '2026-06-12',
        to: '2026-06-10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RoomsService.searchAvailability', () => {
  it('returns rooms not overlapping with active reservations', async () => {
    const { service } = buildService({
      rooms: [ROOM_A, ROOM_B],
      reservations: [{ roomId: ROOM_A.id }] as never,
    });

    const out = await service.searchAvailability(user, 'corr', {
      propertyId: PROPERTY_ID,
      roomTypeId: ROOM_TYPE_ID,
      arrival: '2026-06-10',
      departure: '2026-06-12',
    });
    expect(out.map((r) => r.id)).toEqual([ROOM_B.id]);
  });
});

describe('RoomsService.changeStatus', () => {
  it('updates status and emits room.status_changed', async () => {
    const { service, events } = buildService({
      roomFindFirst: ROOM_A,
    });
    const out = await service.changeStatus(user, 'corr', ROOM_A.id, {
      status: 'DIRTY',
    });
    expect(out.status).toBe('DIRTY');
    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('room.status_changed');
    const payload = events.publish.mock.calls[0]![2] as {
      previousStatus: string;
      newStatus: string;
      isOutOfOrder: boolean;
    };
    expect(payload.previousStatus).toBe('CLEAN');
    expect(payload.newStatus).toBe('DIRTY');
    expect(payload.isOutOfOrder).toBe(false);
  });

  it('flags isOutOfOrder when status becomes OUT_OF_ORDER', async () => {
    const { service, tx } = buildService({ roomFindFirst: ROOM_A });
    await service.changeStatus(user, 'corr', ROOM_A.id, {
      status: 'OUT_OF_ORDER',
      outOfOrderReason: 'broken AC',
    });
    const data = tx.room.update.mock.calls[0]![0].data;
    expect(data.isOutOfOrder).toBe(true);
    expect(data.outOfOrderReason).toBe('broken AC');
  });

  it('throws NotFoundException when room missing', async () => {
    const { service } = buildService({ roomFindFirst: null });
    await expect(
      service.changeStatus(user, 'corr', ROOM_A.id, { status: 'CLEAN' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
