import { ConflictException, NotFoundException } from '@nestjs/common';
import { LostFoundStatus } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { LostFoundService } from './lost-found.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const ROOM_ID = '44444444-4444-4444-4444-444444444444';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const GUEST_ID = '66666666-6666-6666-6666-666666666666';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'hsk@hotel.test',
  roles: ['housekeeping_supervisor'],
};

interface ItemOpts {
  status?: LostFoundStatus;
}

function buildItem(opts: ItemOpts = {}) {
  return {
    id: ITEM_ID,
    tenantId: TENANT_ID,
    propertyId: PROPERTY_ID,
    roomId: ROOM_ID,
    foundByUserId: USER_ID,
    foundAt: new Date('2026-06-10T08:00:00Z'),
    description: 'Anillo de plata',
    photoBase64: null as string | null,
    photoUrl: null as string | null,
    status: opts.status ?? LostFoundStatus.FOUND,
    claimedByGuestId: null as string | null,
    claimedAt: null as Date | null,
    claimedNotes: null as string | null,
    disposedAt: null as Date | null,
    disposedNotes: null as string | null,
    notes: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as Date | null,
  };
}

function buildService(
  opts: {
    room?: { id: string } | null;
    existing?: ReturnType<typeof buildItem> | null;
    guest?: { id: string } | null;
    photoDriver?: 'inline' | 's3';
  } = {},
) {
  let stored = opts.existing ?? null;

  const roomFindFirst = vi
    .fn()
    .mockResolvedValue(opts.room === undefined ? { id: ROOM_ID } : opts.room);
  const guestFindFirst = vi
    .fn()
    .mockResolvedValue(opts.guest === undefined ? { id: GUEST_ID } : opts.guest);
  const itemFindFirst = vi.fn().mockImplementation(() => Promise.resolve(stored));
  const itemFindMany = vi.fn().mockResolvedValue(stored ? [stored] : []);
  const itemCreate = vi.fn().mockImplementation(({ data }) => {
    stored = {
      ...buildItem(),
      ...data,
      id: ITEM_ID,
      foundAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return Promise.resolve(stored);
  });
  const itemUpdate = vi.fn().mockImplementation(({ data }) => {
    if (stored) stored = { ...stored, ...data };
    return Promise.resolve(stored);
  });

  const tx = {
    room: { findFirst: roomFindFirst },
    guest: { findFirst: guestFindFirst },
    lostFoundItem: {
      findFirst: itemFindFirst,
      findMany: itemFindMany,
      create: itemCreate,
      update: itemUpdate,
    },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const metrics = {
    lostFoundRegistered: { add: vi.fn() },
    lostFoundResolved: { add: vi.fn() },
  };

  const driver = opts.photoDriver ?? 'inline';
  const photoStorage = {
    newItemId: vi.fn().mockReturnValue(ITEM_ID),
    getDriver: () => driver,
    store: vi.fn().mockImplementation((_tenantId: string, _itemId: string, dataUrl: string) => {
      if (driver === 's3') {
        return Promise.resolve({
          photoUrl: `https://photos.aubergine.es/${TENANT_ID}/lost-found/${ITEM_ID}.jpg`,
          photoBase64: null,
        });
      }
      return Promise.resolve({ photoUrl: null, photoBase64: dataUrl });
    }),
  };

  const service = new LostFoundService(
    prisma as never,
    events as never,
    metrics as never,
    photoStorage as never,
  );
  return { service, tx, events, metrics, photoStorage };
}

describe('LostFoundService.register', () => {
  it('creates a FOUND item and emits item_registered (no photo)', async () => {
    const { service, events } = buildService();
    const out = await service.register(user, 'corr', {
      propertyId: PROPERTY_ID,
      roomId: ROOM_ID,
      description: 'Cargador olvidado',
    });
    expect(out.status).toBe(LostFoundStatus.FOUND);
    expect(out.hasPhoto).toBe(false);
    expect(events.publish.mock.calls[0]![0]).toBe('lost_found.item_registered');
    expect(events.publish.mock.calls[0]![2]).toMatchObject({ hasPhoto: false });
  });

  it('rejects if room does not exist in property', async () => {
    const { service } = buildService({ room: null });
    await expect(
      service.register(user, 'corr', {
        propertyId: PROPERTY_ID,
        roomId: ROOM_ID,
        description: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('emits hasPhoto:true when a data URL is provided (driver=inline)', async () => {
    const { service, events } = buildService();
    await service.register(user, 'corr', {
      propertyId: PROPERTY_ID,
      description: 'gafas',
      photoBase64: 'data:image/jpeg;base64,AAAA',
    });
    expect(events.publish.mock.calls[0]![2]).toMatchObject({ hasPhoto: true });
  });

  it('uploads to S3 and stores photoUrl when driver=s3', async () => {
    const { service, photoStorage } = buildService({ photoDriver: 's3' });
    const out = await service.register(user, 'corr', {
      propertyId: PROPERTY_ID,
      description: 'gafas',
      photoBase64: 'data:image/jpeg;base64,AAAA',
    });
    expect(photoStorage.store).toHaveBeenCalledOnce();
    expect(out.hasPhoto).toBe(true);
    expect(out.photoUrl).toMatch(/^https:\/\/photos\.aubergine\.es\//);
  });
});

describe('LostFoundService.claim', () => {
  it('moves FOUND -> CLAIMED and emits item_claimed', async () => {
    const { service, events } = buildService({ existing: buildItem() });
    const out = await service.claim(user, 'corr', ITEM_ID, { guestId: GUEST_ID });
    expect(out.status).toBe(LostFoundStatus.CLAIMED);
    expect(out.claimedByGuestId).toBe(GUEST_ID);
    expect(events.publish.mock.calls[0]![0]).toBe('lost_found.item_claimed');
  });

  it('rejects if item already CLAIMED', async () => {
    const { service } = buildService({
      existing: buildItem({ status: LostFoundStatus.CLAIMED }),
    });
    await expect(
      service.claim(user, 'corr', ITEM_ID, { guestId: GUEST_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects if guest does not exist', async () => {
    const { service } = buildService({ existing: buildItem(), guest: null });
    await expect(
      service.claim(user, 'corr', ITEM_ID, { guestId: GUEST_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LostFoundService.dispose', () => {
  it('moves FOUND -> DISPOSED and emits item_disposed', async () => {
    const { service, events } = buildService({ existing: buildItem() });
    const out = await service.dispose(user, 'corr', ITEM_ID, {
      reason: '90d sin reclamar',
    });
    expect(out.status).toBe(LostFoundStatus.DISPOSED);
    expect(events.publish.mock.calls[0]![0]).toBe('lost_found.item_disposed');
    expect(events.publish.mock.calls[0]![2]).toMatchObject({ reason: '90d sin reclamar' });
  });

  it('rejects if item already DISPOSED', async () => {
    const { service } = buildService({
      existing: buildItem({ status: LostFoundStatus.DISPOSED }),
    });
    await expect(service.dispose(user, 'corr', ITEM_ID, { reason: 'x' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
