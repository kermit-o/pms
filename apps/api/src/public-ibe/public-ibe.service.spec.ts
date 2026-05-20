import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicIbeService } from './public-ibe.service';

const PROP = {
  id: 'p-1',
  tenantId: 't-1',
  code: 'HTL',
  name: 'Hotel Berenjena',
  timezone: 'Europe/Madrid',
  currency: 'EUR',
  locale: 'es-ES',
};

function buildService(opts: {
  property?: typeof PROP | null;
  roomTypes?: Array<{ id: string; code: string; name: string; baseOccupancy: number; maxOccupancy: number; defaultRate: number; defaultCurrency: string | null }>;
  rooms?: Array<{ id: string; roomTypeId: string }>;
  overlapping?: Array<{ roomTypeId: string }>;
  reservation?: unknown;
} = {}) {
  const txStub = {
    roomType: {
      findMany: vi.fn().mockResolvedValue(
        opts.roomTypes ?? [
          { id: 'rt-1', code: 'DBL', name: 'Doble', baseOccupancy: 2, maxOccupancy: 2, defaultRate: 100, defaultCurrency: 'EUR' },
        ],
      ),
      findFirst: vi.fn().mockResolvedValue(
        opts.roomTypes?.[0] ?? { id: 'rt-1', maxOccupancy: 2, defaultRate: 100, defaultCurrency: 'EUR' },
      ),
    },
    room: {
      findMany: vi.fn().mockResolvedValue(opts.rooms ?? [{ id: 'r-1', roomTypeId: 'rt-1' }]),
    },
    reservation: {
      findMany: vi.fn().mockResolvedValue(opts.overlapping ?? []),
      findFirst: vi.fn().mockResolvedValue(opts.reservation ?? null),
      create: vi.fn().mockImplementation((args: { data: unknown }) =>
        Promise.resolve({
          id: 'res-1',
          code: 'HTL-ABC',
          status: 'CONFIRMED',
          totalAmount: { toString: () => '300.00' },
          currency: 'EUR',
          data: args.data,
        }),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    guest: { create: vi.fn().mockResolvedValue({ id: 'g-1' }) },
  };
  const prisma = {
    property: { findFirst: vi.fn().mockResolvedValue(opts.property === null ? null : (opts.property ?? PROP)) },
    withTenant: vi.fn(async (_ctx, fn: (t: unknown) => Promise<unknown>) => fn(txStub)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const stripe = {
    createSetupIntent: vi.fn().mockResolvedValue({ clientSecret: 'cs', publishableKey: 'pk' }),
    confirmSetupIntent: vi.fn().mockResolvedValue({ status: 'SECURED', brand: 'visa', last4: '4242' }),
  };
  const notifications = {
    sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: 'm1' }),
    // Sprint 11 W2: PublicIbeService.dispatch* ahora usa enqueueEmail.
    enqueueEmail: vi.fn().mockResolvedValue({ enqueued: true, dedupKey: 'k' }),
  };
  const config = {
    get: vi.fn().mockImplementation((key: string) =>
      key === 'IBE_PUBLIC_URL' ? 'https://book.aubergine.test' : undefined,
    ),
  };
  return {
    service: new PublicIbeService(
      prisma as never,
      events as never,
      stripe as never,
      notifications as never,
      config as never,
    ),
    prisma,
    events,
    stripe,
    notifications,
    tx: txStub,
  };
}

describe('PublicIbeService', () => {
  it('getProperty returns 404 when slug is unknown / unpublished', async () => {
    const { service } = buildService({ property: null });
    await expect(service.getProperty('unknown')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('searchAvailability rejects arrival >= departure', async () => {
    const { service } = buildService();
    await expect(
      service.searchAvailability('h', {
        arrival: '2026-07-15',
        departure: '2026-07-15',
        adults: 2,
        children: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('searchAvailability returns room types with totalForStay', async () => {
    const { service } = buildService({
      rooms: [
        { id: 'r-1', roomTypeId: 'rt-1' },
        { id: 'r-2', roomTypeId: 'rt-1' },
      ],
      overlapping: [{ roomTypeId: 'rt-1' }],
    });
    const out = await service.searchAvailability('h', {
      arrival: '2026-07-15',
      departure: '2026-07-17',
      adults: 2,
      children: 0,
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.available).toBe(1); // 2 rooms - 1 overlap
    expect(out.results[0]!.nights).toBe(2);
    expect(out.results[0]!.totalForStay).toBe('200.00');
  });

  it('createReservation requires gdprConsent', async () => {
    const { service } = buildService();
    await expect(
      service.createReservation('h', {
        arrival: '2026-07-15',
        departure: '2026-07-17',
        roomTypeId: 'rt-1',
        occupancy: { adults: 2, children: 0 },
        guest: {
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.test',
          gdprConsent: false as never,
          marketingConsent: false,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createReservation persists guest + reservation + folio and emits event', async () => {
    const { service, events, tx } = buildService();
    const out = await service.createReservation('h', {
      arrival: '2026-07-15',
      departure: '2026-07-17',
      roomTypeId: 'rt-1',
      occupancy: { adults: 2, children: 0 },
      guest: {
        firstName: 'María',
        lastName: 'Pérez',
        email: 'maria@example.com',
        gdprConsent: true,
        marketingConsent: true,
      },
    });
    expect(out.code).toMatch(/HTL-/);
    expect(tx.guest.create).toHaveBeenCalledOnce();
    expect(tx.reservation.create).toHaveBeenCalledOnce();
    expect(events.publish).toHaveBeenCalledWith(
      'reservation.created',
      expect.any(Object),
      expect.objectContaining({ code: 'HTL-ABC', source: 'DIRECT' }),
    );
  });

  it('getReservation 404 if code+lastName mismatch', async () => {
    const { service } = buildService({ reservation: null });
    await expect(service.getReservation('h', 'HTL-X', 'Pérez')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('createSetupIntent delegates to StripeService with sentinel actor', async () => {
    const { service, stripe } = buildService({
      reservation: { id: 'res-1' },
    });
    const out = await service.createSetupIntent('h', 'HTL-X', 'Pérez');
    expect(stripe.createSetupIntent).toHaveBeenCalledOnce();
    const [user, , reservationId] = stripe.createSetupIntent.mock.calls[0]!;
    expect((user as { tenantId: string }).tenantId).toBe('t-1');
    expect((user as { sub: string }).sub).toBe('00000000-0000-0000-0000-000000000000');
    expect(reservationId).toBe('res-1');
    expect(out).toEqual({ clientSecret: 'cs', publishableKey: 'pk' });
  });

  it('createSetupIntent rechaza si code+lastName no coinciden', async () => {
    const { service } = buildService({ reservation: null });
    await expect(service.createSetupIntent('h', 'X', 'Y')).rejects.toBeInstanceOf(NotFoundException);
  });
});
