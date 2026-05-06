import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { CashService } from './cash.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const RECON_ID = '44444444-4444-4444-4444-444444444444';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'auditor@hotel.test',
  roles: ['night_auditor'],
};

interface BuildOpts {
  existing?: {
    id: string;
    propertyId: string;
    businessDate: Date;
    currency: string;
    expectedAmount: Prisma.Decimal;
    countedAmount: Prisma.Decimal;
    discrepancy: Prisma.Decimal;
    toleranceCents: number;
    countedByUserId: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  /** CASH PAYMENT folio entries on the day; positive amounts represent the
   * cash a guest paid (we'll persist the negative sign internally). */
  cashPayments?: Array<{ amount: Prisma.Decimal }>;
}

function buildService(opts: BuildOpts = {}) {
  const reconFindFirst = vi.fn().mockResolvedValue(opts.existing ?? null);
  const reconCreate = vi.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      id: RECON_ID,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
  const reconUpdate = vi.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      ...(opts.existing ?? { id: RECON_ID }),
      ...data,
      updatedAt: new Date(),
    }),
  );
  // Folio payments are stored with a NEGATIVE sign convention. The mock
  // returns rows shaped that way so the service negates them back to a
  // positive expected total.
  const folioFindMany = vi
    .fn()
    .mockResolvedValue((opts.cashPayments ?? []).map((p) => ({ amount: p.amount.negated() })));

  const tx = {
    cashDrawerReconciliation: {
      findFirst: reconFindFirst,
      create: reconCreate,
      update: reconUpdate,
    },
    folioEntry: { findMany: folioFindMany },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };

  const service = new CashService(prisma as never, events as never);
  return { service, tx, events };
}

describe('CashService.upsert', () => {
  it('creates a row with discrepancy = counted - expected, emits created', async () => {
    const { service, tx, events } = buildService({
      cashPayments: [
        { amount: new Prisma.Decimal('50.00') },
        { amount: new Prisma.Decimal('75.00') },
      ],
    });
    const out = await service.upsert(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
      countedAmount: 130,
      currency: 'EUR',
    });
    expect(out.expectedAmount).toBe('125');
    expect(out.countedAmount).toBe('130');
    expect(out.discrepancy).toBe('5');
    expect(tx.cashDrawerReconciliation.create).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls.map((c) => c[0])).toEqual([
      'cash.reconciliation_created',
      'cash.reconciliation_discrepancy', // 500 cents > 0 default tolerance
    ]);
  });

  it('updates an existing row when one is present', async () => {
    const { service, tx } = buildService({
      existing: {
        id: RECON_ID,
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        currency: 'EUR',
        expectedAmount: new Prisma.Decimal('0'),
        countedAmount: new Prisma.Decimal('0'),
        discrepancy: new Prisma.Decimal('0'),
        toleranceCents: 0,
        countedByUserId: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      cashPayments: [{ amount: new Prisma.Decimal('100.00') }],
    });
    await service.upsert(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
      countedAmount: 100,
      currency: 'EUR',
    });
    expect(tx.cashDrawerReconciliation.update).toHaveBeenCalledOnce();
    expect(tx.cashDrawerReconciliation.create).not.toHaveBeenCalled();
  });

  it('skips the discrepancy event when |discrepancy| is within tolerance', async () => {
    const { service, events } = buildService({
      cashPayments: [{ amount: new Prisma.Decimal('100.00') }],
    });
    await service.upsert(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
      countedAmount: 100.5,
      currency: 'EUR',
      toleranceCents: 100, // 1.00 tolerance, 0.50 discrepancy
    });
    expect(events.publish.mock.calls.map((c) => c[0])).toEqual(['cash.reconciliation_created']);
  });
});

describe('CashService.getOrEmpty', () => {
  it('returns expected from CASH payments when no row exists yet', async () => {
    const { service } = buildService({
      cashPayments: [{ amount: new Prisma.Decimal('40.00') }],
    });
    const view = await service.getOrEmpty(user, 'corr', PROPERTY_ID, '2026-06-10');
    expect(view.id).toBeNull();
    expect(view.expectedAmount).toBe('40');
    expect(view.countedAmount).toBe('0');
  });
});

describe('CashService.require', () => {
  it('throws NotFoundException when no row exists', async () => {
    const { service } = buildService({});
    await expect(service.require(user, 'corr', PROPERTY_ID, '2026-06-10')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
