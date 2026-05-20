import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PublicOnboardingService } from './public-onboarding.service';

const SECRET = 'b'.repeat(64);

function buildService(opts: {
  email?: string;
  notifyOk?: boolean;
  tenant?: { id: string; onboardingStatus?: string | null } | null;
} = {}) {
  const tenantRow = {
    id: 't-1',
    slug: 'pending-deadbeef',
    name: 'Pending — x',
    onboardingStatus: opts.tenant?.onboardingStatus ?? 'EMAIL_VERIFIED',
  };
  const prisma = {
    tenant: {
      upsert: vi.fn().mockResolvedValue(tenantRow),
      findUnique: vi.fn().mockResolvedValue(
        opts.tenant === null ? null : (opts.tenant ?? tenantRow),
      ),
      update: vi.fn().mockResolvedValue({ ...tenantRow, slug: 'hotel-x-12345678', name: 'Hotel X' }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txStub)),
  };
  const txStub = {
    tenant: prisma.tenant,
    property: {
      create: vi.fn().mockResolvedValue({ id: 'p-1', publicSlug: 'hotel-x-abcd' }),
    },
    roomType: {
      create: vi.fn().mockResolvedValue({ id: 'rt-1' }),
    },
    room: {
      createMany: vi.fn().mockResolvedValue({ count: 12 }),
    },
    user: {
      create: vi.fn().mockResolvedValue({ id: 'u-1' }),
    },
  };
  const notifications = {
    sendEmail: vi
      .fn()
      .mockResolvedValue(
        opts.notifyOk === false
          ? { ok: false, error: 'postmark_down' }
          : { ok: true, messageId: 'm-1' },
      ),
  };
  const config = {
    get: vi.fn((key: string) => {
      const env: Record<string, unknown> = {
        ONBOARDING_SECRET: SECRET,
        ONBOARDING_TOKEN_TTL_HOURS: 24,
        BACKOFFICE_PUBLIC_URL: 'https://fo.test',
        IBE_PUBLIC_URL: 'https://ibe.test',
        NODE_ENV: 'test',
      };
      return env[key];
    }),
  };
  const service = new PublicOnboardingService(
    prisma as never,
    notifications as never,
    config as never,
  );
  service.onModuleInit();
  return { service, prisma, notifications, tx: txStub };
}

describe('PublicOnboardingService.start', () => {
  it('sends a verify email and returns queued: true', async () => {
    const { service, notifications } = buildService();
    const out = await service.start({ email: 'GuEst@Test.com', locale: 'es' });
    expect(out).toEqual({ queued: true, email: 'guest@test.com' });
    expect(notifications.sendEmail).toHaveBeenCalledOnce();
    const args = notifications.sendEmail.mock.calls[0]![0]!;
    expect(args.template).toBe('onboarding_verify');
    expect(args.to).toBe('guest@test.com');
    expect(args.params.verifyUrl).toMatch(/^https:\/\/fo\.test\/onboarding\/verify\?token=/);
  });

  it('surfaces ServiceUnavailableException if notifications fail', async () => {
    const { service } = buildService({ notifyOk: false });
    await expect(service.start({ email: 'a@b.test', locale: 'es' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('PublicOnboardingService.verify', () => {
  it('rejects malformed tokens', async () => {
    const { service } = buildService();
    await expect(service.verify('not.a.real.token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts a TRIAL tenant and returns a setup token', async () => {
    const { service, prisma } = buildService();
    const startOut = await captureToken(service, 'a@b.test');
    const out = await service.verify(startOut.token);
    expect(prisma.tenant.upsert).toHaveBeenCalledOnce();
    expect(prisma.tenant.upsert.mock.calls[0]![0]!.create.onboardingStatus).toBe(
      'EMAIL_VERIFIED',
    );
    expect(out.tenantId).toBe('t-1');
    expect(out.email).toBe('a@b.test');
    expect(out.setupToken).toMatch(/^.+\..+$/);
    expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('PublicOnboardingService.setup', () => {
  it('rejects a verify-kind token', async () => {
    const { service } = buildService();
    const startOut = await captureToken(service, 'a@b.test');
    await expect(
      service.setup({
        token: startOut.token,
        hotel: validHotel(),
        admin: { fullName: 'Mr X' },
        acceptTerms: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates property + rooms + admin user and marks SETUP_DONE', async () => {
    const { service, prisma, tx } = buildService();
    const setupTok = await captureSetupToken(service, 'owner@hotel.test');
    const out = await service.setup({
      token: setupTok,
      hotel: validHotel(),
      admin: { fullName: 'Owner Name' },
      acceptTerms: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.property.create).toHaveBeenCalledOnce();
    expect(tx.roomType.create).toHaveBeenCalledOnce();
    expect(tx.room.createMany).toHaveBeenCalledOnce();
    expect(tx.room.createMany.mock.calls[0]![0]!.data).toHaveLength(12);
    expect(tx.user.create).toHaveBeenCalledOnce();
    expect(tx.user.create.mock.calls[0]![0]!.data.email).toBe('owner@hotel.test');
    expect(out.tenantId).toBe('t-1');
    expect(out.adminEmail).toBe('owner@hotel.test');
    expect(out.propertySlug).toMatch(/^hotel-/);
    expect(out.ibeUrl).toMatch(/^https:\/\/ibe\.test\/h\//);
  });

  it('rejects when tenant is already SETUP_DONE (idempotency)', async () => {
    const { service } = buildService({
      tenant: { id: 't-1', onboardingStatus: 'SETUP_DONE' },
    });
    const setupTok = await captureSetupToken(service, 'owner@hotel.test');
    await expect(
      service.setup({
        token: setupTok,
        hotel: validHotel(),
        admin: { fullName: 'Owner Name' },
        acceptTerms: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function validHotel() {
  return {
    name: 'Hotel Berenjena',
    city: 'Madrid',
    country: 'ES',
    timezone: 'Europe/Madrid',
    currency: 'EUR',
    locale: 'es-ES' as const,
    roomsCount: 12,
  };
}

async function captureToken(
  service: PublicOnboardingService,
  email: string,
): Promise<{ token: string }> {
  const svc = service as unknown as { notifications: { sendEmail: ReturnType<typeof vi.fn> } };
  await service.start({ email, locale: 'es' });
  const call = svc.notifications.sendEmail.mock.calls.at(-1)!;
  const url: string = call[0]!.params.verifyUrl;
  const token = decodeURIComponent(url.split('token=')[1]!);
  return { token };
}

async function captureSetupToken(
  service: PublicOnboardingService,
  email: string,
): Promise<string> {
  const { token } = await captureToken(service, email);
  const verified = await service.verify(token);
  return verified.setupToken;
}
