import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { GuestsService } from './guests.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const GUEST_ID = '33333333-3333-3333-3333-333333333333';

const adminUser: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'admin@hotel.test',
  roles: ['tenant_admin'],
};

const deskUser: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};

function buildService(opts: {
  documentMatch?: { id: string };
  emailMatch?: { id: string };
  guestExists?: { id: string; deletedAt?: Date | null } | null;
}) {
  const guestFindFirst = vi.fn().mockImplementation((args) => {
    const where = args?.where ?? {};
    if (where.documentNumber && where.documentType) {
      return Promise.resolve(opts.documentMatch ?? null);
    }
    if (where.email) {
      return Promise.resolve(opts.emailMatch ?? null);
    }
    return Promise.resolve(opts.guestExists ?? null);
  });

  const guestCreate = vi.fn().mockResolvedValue({ id: GUEST_ID });
  const guestUpdate = vi.fn().mockResolvedValue({ id: GUEST_ID });

  const tx = {
    guest: {
      findFirst: guestFindFirst,
      create: guestCreate,
      update: guestUpdate,
    },
  };

  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };

  const service = new GuestsService(prisma as never, events as never);
  return { service, tx, events };
}

describe('GuestsService.create', () => {
  it('creates a new guest and emits guest.created', async () => {
    const { service, tx, events } = buildService({});
    const out = await service.create(deskUser, 'corr', {
      firstName: 'Ana',
      lastName: 'García',
      email: 'ana@example.com',
      documentType: 'DNI',
      documentNumber: '12345678Z',
      gdprConsent: true,
      marketingConsent: false,
    });
    expect(out).toEqual({ id: GUEST_ID, deduplicated: false });
    expect(tx.guest.create).toHaveBeenCalledOnce();
    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('guest.created');
    const payload = events.publish.mock.calls[0]![2] as { documentHash: string };
    expect(payload.documentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the existing guest id on duplicate document and skips event', async () => {
    const { service, tx, events } = buildService({
      documentMatch: { id: 'existing-1' },
    });
    const out = await service.create(deskUser, 'corr', {
      firstName: 'Ana',
      lastName: 'García',
      documentType: 'DNI',
      documentNumber: '12345678Z',
      gdprConsent: true,
      marketingConsent: false,
    });
    expect(out).toEqual({ id: 'existing-1', deduplicated: true });
    expect(tx.guest.create).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('returns the existing guest id on duplicate email and skips event', async () => {
    const { service, tx, events } = buildService({
      emailMatch: { id: 'existing-2' },
    });
    const out = await service.create(deskUser, 'corr', {
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'bob@example.com',
      gdprConsent: true,
      marketingConsent: false,
    });
    expect(out).toEqual({ id: 'existing-2', deduplicated: true });
    expect(tx.guest.create).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });
});

describe('GuestsService.patch', () => {
  it('updates fields and emits guest.updated', async () => {
    const { service, tx, events } = buildService({
      guestExists: { id: GUEST_ID },
    });
    const out = await service.patch(deskUser, 'corr', GUEST_ID, {
      phone: '+34 600 000 000',
    });
    expect(out).toEqual({ id: GUEST_ID });
    expect(tx.guest.update).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('guest.updated');
  });

  it('throws ConflictException when no fields provided', async () => {
    const { service } = buildService({});
    await expect(
      service.patch(deskUser, 'corr', GUEST_ID, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when guest does not exist', async () => {
    const { service } = buildService({ guestExists: null });
    await expect(
      service.patch(deskUser, 'corr', GUEST_ID, { phone: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GuestsService.erase', () => {
  it('soft erases (anonymises) PII and emits guest.erased with hard:false', async () => {
    const { service, tx, events } = buildService({
      guestExists: { id: GUEST_ID, deletedAt: null },
    });
    const out = await service.erase(deskUser, 'corr', GUEST_ID, {
      reason: 'request',
      hard: false,
    });
    expect(out).toEqual({ id: GUEST_ID, hard: false });
    const update = tx.guest.update.mock.calls[0]![0];
    expect(update.data.firstName).toBe('[REDACTED]');
    expect(update.data.lastName).toBe('[REDACTED]');
    expect(update.data.email).toBeNull();
    expect(update.data.deletedAt).toBeUndefined();
    expect(events.publish.mock.calls[0]![0]).toBe('guest.erased');
  });

  it('hard erase by tenant_admin sets deletedAt', async () => {
    const { service, tx } = buildService({
      guestExists: { id: GUEST_ID, deletedAt: null },
    });
    await service.erase(adminUser, 'corr', GUEST_ID, {
      reason: 'retention expired',
      hard: true,
    });
    const update = tx.guest.update.mock.calls[0]![0];
    expect(update.data.deletedAt).toBeInstanceOf(Date);
  });

  it('hard erase requires tenant_admin', async () => {
    const { service } = buildService({
      guestExists: { id: GUEST_ID, deletedAt: null },
    });
    await expect(
      service.erase(deskUser, 'corr', GUEST_ID, {
        reason: 'oops',
        hard: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
