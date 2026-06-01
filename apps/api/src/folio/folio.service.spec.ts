import { ConflictException, NotFoundException } from '@nestjs/common';
import { FolioStatus, Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { FolioService } from './folio.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const RESERVATION_ID = '44444444-4444-4444-4444-444444444444';
const FOLIO_ID = '55555555-5555-5555-5555-555555555555';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};

interface FolioRow {
  id: string;
  status: FolioStatus;
  balance: Prisma.Decimal;
  currency: string;
  reservationId: string;
  reservation: { propertyId: string };
  closedAt?: Date | null;
}

function buildService(opts: {
  folio?: FolioRow | null;
  existingEntry?: { id: string } | null;
  createdEntryId?: string;
  uniqueViolationOnCreate?: boolean;
}) {
  const folioFindFirst = vi.fn().mockResolvedValue(opts.folio ?? null);
  const folioUpdate = vi.fn().mockResolvedValue({});
  const entryFindFirst = vi.fn().mockResolvedValue(opts.existingEntry ?? null);
  const entryCreate = vi.fn();
  if (opts.uniqueViolationOnCreate) {
    entryCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
  } else {
    entryCreate.mockResolvedValue({
      id: opts.createdEntryId ?? 'entry-001',
      postedAt: new Date('2026-06-10T10:00:00Z'),
    });
  }

  const tx = {
    folio: { findFirst: folioFindFirst, update: folioUpdate },
    folioEntry: { findFirst: entryFindFirst, create: entryCreate },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };

  const service = new FolioService(prisma as never, events as never);
  return { service, tx, events };
}

describe('FolioService.addCharge', () => {
  it('appends a CHARGE entry and updates balance + emits folio.charge_added', async () => {
    const { service, tx, events } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.OPEN,
        balance: new Prisma.Decimal(0),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
      createdEntryId: 'entry-charge-1',
    });

    const out = await service.addCharge(user, 'corr', FOLIO_ID, {
      description: 'Habitación 10/06',
      amount: 120,
      type: 'CHARGE',
    });

    expect(out.entryId).toBe('entry-charge-1');
    expect(out.balance).toBe('120');
    expect(out.deduplicated).toBe(false);
    expect(tx.folio.update).toHaveBeenCalledOnce();
    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('folio.charge_added');
  });

  it('returns existing entry when idempotency_key was already used (pre-check)', async () => {
    const { service, tx, events } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.OPEN,
        balance: new Prisma.Decimal(50),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
      existingEntry: { id: 'entry-existing' },
    });

    const out = await service.addCharge(user, 'corr', FOLIO_ID, {
      description: 'Habitación 10/06',
      amount: 120,
      type: 'CHARGE',
      idempotencyKey: 'op-001',
    });

    expect(out.entryId).toBe('entry-existing');
    expect(out.deduplicated).toBe(true);
    expect(tx.folioEntry.create).not.toHaveBeenCalled();
    expect(tx.folio.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('handles racy unique-violation by returning the previously-created entry', async () => {
    const { service, tx, events } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.OPEN,
        balance: new Prisma.Decimal(0),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
      uniqueViolationOnCreate: true,
    });
    // First call: pre-check sees nothing (default null), then create throws
    // P2002, then a follow-up findFirst returns the persisted row.
    tx.folioEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'entry-race-1' });

    const out = await service.addCharge(user, 'corr', FOLIO_ID, {
      description: 'Habitación 10/06',
      amount: 120,
      type: 'CHARGE',
      idempotencyKey: 'op-race',
    });

    expect(out.entryId).toBe('entry-race-1');
    expect(out.deduplicated).toBe(true);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('throws ConflictException when folio is CLOSED', async () => {
    const { service } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.CLOSED,
        balance: new Prisma.Decimal(0),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
    });
    await expect(
      service.addCharge(user, 'corr', FOLIO_ID, {
        description: 'x',
        amount: 1,
        type: 'CHARGE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when folio does not exist', async () => {
    const { service } = buildService({ folio: null });
    await expect(
      service.addCharge(user, 'corr', FOLIO_ID, {
        description: 'x',
        amount: 1,
        type: 'CHARGE',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FolioService.addPayment', () => {
  it('stores PAYMENT as a negative entry and updates balance', async () => {
    const { service, tx, events } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.OPEN,
        balance: new Prisma.Decimal(120),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
      createdEntryId: 'entry-pay-1',
    });

    const out = await service.addPayment(user, 'corr', FOLIO_ID, {
      description: 'Tarjeta Visa',
      amount: 120,
      paymentMethod: 'CARD',
      reference: 'STRIPE-1',
    });

    expect(out.balance).toBe('0');
    const createCall = tx.folioEntry.create.mock.calls[0]![0];
    expect(createCall.data.type).toBe('PAYMENT');
    expect(createCall.data.amount.toString()).toBe('-120');
    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('folio.payment_received');
  });
});

describe('FolioService.close', () => {
  it('closes a folio with zero balance and emits folio.closed', async () => {
    const { service, events } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.OPEN,
        balance: new Prisma.Decimal(0),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
    });

    const out = await service.close(user, 'corr', FOLIO_ID);
    expect(out).toEqual({ id: FOLIO_ID });
    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('folio.closed');
  });

  it('rejects close when balance is non-zero', async () => {
    const { service } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.OPEN,
        balance: new Prisma.Decimal(50),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
    });
    await expect(service.close(user, 'corr', FOLIO_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects close on already-closed folio', async () => {
    const { service } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.SETTLED,
        balance: new Prisma.Decimal(0),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
    });
    await expect(service.close(user, 'corr', FOLIO_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FolioService.reopen', () => {
  it('reopens a SETTLED folio and emits folio.reopened', async () => {
    const { service, events } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.SETTLED,
        balance: new Prisma.Decimal(0),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
    });
    const out = await service.reopen(user, 'corr', FOLIO_ID, {
      reason: 'late charge',
    });
    expect(out).toEqual({ id: FOLIO_ID });
    expect(events.publish.mock.calls[0]![0]).toBe('folio.reopened');
  });

  it('rejects reopen on already-OPEN folio', async () => {
    const { service } = buildService({
      folio: {
        id: FOLIO_ID,
        status: FolioStatus.OPEN,
        balance: new Prisma.Decimal(0),
        currency: 'EUR',
        reservationId: RESERVATION_ID,
        reservation: { propertyId: PROPERTY_ID },
      },
    });
    await expect(service.reopen(user, 'corr', FOLIO_ID, { reason: 'x' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('FolioService.findOne + findByReservationCode (read paths)', () => {
  const folioDetailRow = {
    id: FOLIO_ID,
    status: FolioStatus.OPEN,
    balance: new Prisma.Decimal('110.00'),
    currency: 'EUR',
    closedAt: null,
    reservationId: RESERVATION_ID,
    createdAt: new Date('2026-06-10T08:00:00Z'),
    updatedAt: new Date('2026-06-10T09:00:00Z'),
    entries: [
      {
        id: 'entry-001',
        type: 'CHARGE',
        description: 'Habitación',
        amount: new Prisma.Decimal('110.00'),
        currency: 'EUR',
        postedAt: new Date('2026-06-10T09:00:00Z'),
        postedBy: USER_ID,
        attributes: null,
      },
    ],
  };

  function buildReadService(opts: {
    folio?: typeof folioDetailRow | null;
    reservation?: { id: string; code: string; folio: typeof folioDetailRow | null } | null;
  }) {
    const tx = {
      folio: { findFirst: vi.fn().mockResolvedValue(opts.folio ?? null) },
      reservation: { findFirst: vi.fn().mockResolvedValue(opts.reservation ?? null) },
    };
    const prisma = {
      withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const events = { publish: vi.fn() };
    return {
      service: new FolioService(
        prisma as unknown as ConstructorParameters<typeof FolioService>[0],
        events as unknown as ConstructorParameters<typeof FolioService>[1],
      ),
      tx,
    };
  }

  it('findOne devuelve el folio + entries cuando existe', async () => {
    const { service } = buildReadService({ folio: folioDetailRow });
    const r = await service.findOne(user, 'corr', FOLIO_ID);
    expect(r.id).toBe(FOLIO_ID);
    expect(r.status).toBe(FolioStatus.OPEN);
    expect(r.balance).toBe('110');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.description).toBe('Habitación');
  });

  it('findOne lanza NotFoundException cuando el folio no existe (o pertenece a otro tenant)', async () => {
    const { service } = buildReadService({ folio: null });
    await expect(service.findOne(user, 'corr', FOLIO_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByReservationCode devuelve folio + reservationCode cuando existe', async () => {
    const { service } = buildReadService({
      reservation: { id: RESERVATION_ID, code: 'BBM01-AB12', folio: folioDetailRow },
    });
    const r = await service.findByReservationCode(user, 'corr', PROPERTY_ID, 'BBM01-AB12');
    expect(r.id).toBe(FOLIO_ID);
    expect(r.reservationCode).toBe('BBM01-AB12');
    expect(r.entries).toHaveLength(1);
  });

  it('findByReservationCode lanza NotFound si la reserva no existe', async () => {
    const { service } = buildReadService({ reservation: null });
    await expect(
      service.findByReservationCode(user, 'corr', PROPERTY_ID, 'BBM01-NONE'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByReservationCode lanza NotFound si la reserva existe pero sin folio', async () => {
    const { service } = buildReadService({
      reservation: { id: RESERVATION_ID, code: 'BBM01-AB12', folio: null },
    });
    await expect(
      service.findByReservationCode(user, 'corr', PROPERTY_ID, 'BBM01-AB12'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByReservationCode aísla por propertyId (no cross-property leakage)', async () => {
    const { service, tx } = buildReadService({
      reservation: { id: RESERVATION_ID, code: 'BBM01-AB12', folio: folioDetailRow },
    });
    await service.findByReservationCode(user, 'corr', PROPERTY_ID, 'BBM01-AB12');
    const where = tx.reservation.findFirst.mock.calls[0]![0]!.where;
    expect(where.propertyId).toBe(PROPERTY_ID);
    expect(where.code).toBe('BBM01-AB12');
    expect(where.deletedAt).toBeNull();
  });
});
