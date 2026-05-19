import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelManagerService } from './channel-manager.service';
import { SiteMinderProvider } from './providers/siteminder.provider';
import type { ChannelManagerMetrics } from './channel-manager.metrics';

const SECRET = 'shared-secret-1234';

function stubMetrics(): ChannelManagerMetrics {
  return {
    syncTotal: { add: vi.fn() },
    syncDuration: { record: vi.fn() },
    inboundTotal: { add: vi.fn() },
    webhookRejections: { add: vi.fn() },
  } as unknown as ChannelManagerMetrics;
}

function buildService(opts: {
  property?: {
    id?: string;
    tenantId?: string;
    code?: string;
    channelManagerProvider?: string | null;
    channelManagerCredentialsRef?: string | null;
  } | null;
  existingReservation?: { id: string; code: string; status: string } | null;
  roomType?: { id: string } | null;
} = {}) {
  const property = opts.property === undefined
    ? {
        id: 'p-1',
        tenantId: 't-1',
        code: 'BBM',
        channelManagerProvider: 'siteminder',
        channelManagerCredentialsRef: 'CM_SITEMINDER_HMAC_SECRET',
      }
    : opts.property;
  const txStub = {
    roomType: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.roomType === null
            ? null
            : (opts.roomType ?? { id: 'rt-1', defaultCurrency: 'EUR' }),
        ),
    },
    reservation: {
      findFirst: vi.fn().mockResolvedValue(opts.existingReservation ?? null),
      create: vi.fn().mockResolvedValue({ id: 'r-new', code: 'BBM-X1' }),
      update: vi.fn().mockResolvedValue({ id: 'r-existing', code: 'BBM-Y2' }),
    },
  };
  const prisma = {
    property: {
      findFirst: vi.fn().mockResolvedValue(property),
      findUnique: vi.fn().mockResolvedValue(property),
    },
    channelSyncRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    withTenant: vi.fn(async (_ctx, fn: (t: typeof txStub) => unknown) => fn(txStub)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const metrics = stubMetrics();
  const config = {
    get: vi.fn((key: string) => {
      const env: Record<string, unknown> = {
        CM_SITEMINDER_API_BASE: 'https://siteminder.test',
        CM_SITEMINDER_HMAC_SECRET: SECRET,
      };
      return env[key];
    }),
  };
  const service = new ChannelManagerService(
    prisma as never,
    events as never,
    metrics,
    config as never,
    new SiteMinderProvider(),
  );
  return { service, prisma, events, metrics, tx: txStub };
}

function signedBody(body: object): { raw: string; headers: Record<string, string> } {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
  return { raw, headers: { 'x-siteminder-signature': sig } };
}

describe('ChannelManagerService.processInboundBooking', () => {
  const validBody = {
    reservationId: 'sm-ext-1',
    channelCode: 'BDC',
    arrival: '2026-07-15',
    departure: '2026-07-17',
    adults: 2,
    children: 0,
    roomTypeCode: 'DBL',
    total: { amount: '200.00', currency: 'EUR' },
    customer: { firstName: 'A', lastName: 'B', email: 'a@b.test' },
  };

  it('rejects unknown slug with NotFoundException', async () => {
    const { service } = buildService({ property: null });
    const { raw, headers } = signedBody(validBody);
    await expect(
      service.processInboundBooking({ slug: 'unknown', rawBody: raw, headers }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects property without CM configured', async () => {
    const { service } = buildService({
      property: {
        id: 'p-1',
        tenantId: 't-1',
        code: 'BBM',
        channelManagerProvider: null,
        channelManagerCredentialsRef: null,
      },
    });
    const { raw, headers } = signedBody(validBody);
    await expect(
      service.processInboundBooking({ slug: 'h', rawBody: raw, headers }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects bad HMAC signature with ForbiddenException', async () => {
    const { service, metrics } = buildService();
    await expect(
      service.processInboundBooking({
        slug: 'h',
        rawBody: JSON.stringify(validBody),
        headers: { 'x-siteminder-signature': 'wrong' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(metrics.webhookRejections.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ reason: 'bad_signature' }),
    );
  });

  it('creates a reservation on first webhook (outcome: created)', async () => {
    const { service, tx, events, metrics } = buildService();
    const { raw, headers } = signedBody(validBody);
    const out = await service.processInboundBooking({ slug: 'h', rawBody: raw, headers });
    expect(out.outcome).toBe('created');
    expect(tx.reservation.create).toHaveBeenCalledOnce();
    expect(tx.reservation.create.mock.calls[0]![0]!.data.externalRef).toBe('sm-ext-1');
    expect(tx.reservation.create.mock.calls[0]![0]!.data.source).toBe('BOOKING_COM');
    expect(events.publish).toHaveBeenCalledWith(
      'channel.inbound_reservation_received',
      expect.any(Object),
      expect.objectContaining({ outcome: 'created', source: 'BOOKING_COM' }),
    );
    expect(metrics.inboundTotal.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ outcome: 'created' }),
    );
  });

  it('updates the same reservation on second webhook with same externalRef (idempotency)', async () => {
    const { service, tx } = buildService({
      existingReservation: { id: 'r-existing', code: 'BBM-Y2', status: 'CONFIRMED' },
    });
    const { raw, headers } = signedBody(validBody);
    const out = await service.processInboundBooking({ slug: 'h', rawBody: raw, headers });
    expect(out.outcome).toBe('updated');
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.reservation.update).toHaveBeenCalledOnce();
  });

  it('rejects when room type code is unknown', async () => {
    const { service } = buildService({ roomType: null });
    const { raw, headers } = signedBody(validBody);
    await expect(
      service.processInboundBooking({ slug: 'h', rawBody: raw, headers }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChannelManagerService.pushDelta', () => {
  it('no-op silencioso si property no tiene provider', async () => {
    const { service, prisma } = buildService({
      property: {
        id: 'p-1',
        tenantId: 't-1',
        code: 'BBM',
        channelManagerProvider: null,
        channelManagerCredentialsRef: null,
      },
    });
    await service.pushDelta({
      propertyId: 'p-1',
      arrival: '2026-07-15',
      departure: '2026-07-17',
    });
    expect(prisma.channelSyncRun.create).not.toHaveBeenCalled();
  });

  it('crea ChannelSyncRun SKIPPED si falta config api_base/secret', async () => {
    const { service, prisma } = buildService();
    // Sobrescribimos config.get para que no devuelva la base URL.
    const cfg = (service as unknown as { config: { get: ReturnType<typeof vi.fn> } }).config;
    cfg.get = vi.fn((key: string) => (key === 'CM_SITEMINDER_HMAC_SECRET' ? SECRET : undefined));
    await service.pushDelta({
      propertyId: 'p-1',
      arrival: '2026-07-15',
      departure: '2026-07-17',
    });
    expect(prisma.channelSyncRun.create).toHaveBeenCalledOnce();
    expect(prisma.channelSyncRun.create.mock.calls[0]![0]!.data.status).toBe('SKIPPED');
  });
});
