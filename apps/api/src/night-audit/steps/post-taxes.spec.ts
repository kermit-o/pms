import { FolioStatus, Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { StepContext } from '../step';
import { PostTaxesStep } from './post-taxes';

const RES_ID = '11111111-1111-1111-1111-111111111111';
const FOLIO_ID = '22222222-2222-2222-2222-222222222222';

function buildCtx(overrides: {
  reservations?: unknown[];
  baseEntryAmount?: string;
  existingTaxEntry?: { id: string } | null;
}) {
  const reservationFindMany = vi.fn().mockResolvedValue(overrides.reservations ?? []);
  const folioEntryCreate = vi.fn().mockResolvedValue({ id: 'tax-entry' });
  const folioUpdate = vi.fn().mockResolvedValue({});
  const folioEntryFindFirst = vi.fn().mockImplementation(({ where, select }) => {
    if (where?.idempotencyKey?.startsWith('na:room:') && select?.amount) {
      return Promise.resolve(
        overrides.baseEntryAmount
          ? { amount: new Prisma.Decimal(overrides.baseEntryAmount) }
          : null,
      );
    }
    if (where?.idempotencyKey?.startsWith('na:tax:')) {
      return Promise.resolve(overrides.existingTaxEntry ?? null);
    }
    return Promise.resolve(null);
  });

  const txProxy = {
    reservation: { findMany: reservationFindMany },
    folioEntry: {
      findFirst: folioEntryFindFirst,
      create: folioEntryCreate,
    },
    folio: { update: folioUpdate },
  } as unknown as StepContext['tx'];

  const ctx: StepContext = {
    tx: txProxy,
    user: {
      sub: 'user',
      tenantId: 'tenant',
      email: 'a@b',
      roles: ['night_auditor'],
    },
    correlationId: 'c',
    runId: 'run',
    propertyId: 'prop',
    businessDate: '2026-06-10',
    businessDateAsDate: new Date('2026-06-10'),
  };
  return { ctx, folioEntryCreate };
}

describe('PostTaxesStep', () => {
  const reservation = {
    id: RES_ID,
    currency: 'EUR',
    roomType: { attributes: null },
    ratePlan: null,
    folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
  };

  it('posts a TAX entry at default 10% over the room charge', async () => {
    const { ctx, folioEntryCreate } = buildCtx({
      reservations: [reservation],
      baseEntryAmount: '100.00',
    });
    const out = await new PostTaxesStep().run(ctx);
    expect(folioEntryCreate).toHaveBeenCalledOnce();
    const data = folioEntryCreate.mock.calls[0]![0].data;
    expect(data.type).toBe('TAX');
    expect(data.idempotencyKey).toBe(`na:tax:2026-06-10:${RES_ID}`);
    expect(data.amount.toString()).toBe('10');
    expect(out.totals?.taxesPosted).toBe(1);
  });

  it('uses RatePlan.attributes.taxRate when present', async () => {
    const { ctx, folioEntryCreate } = buildCtx({
      reservations: [
        {
          ...reservation,
          ratePlan: { attributes: { taxRate: 0.21 } },
        },
      ],
      baseEntryAmount: '100.00',
    });
    await new PostTaxesStep().run(ctx);
    const data = folioEntryCreate.mock.calls[0]![0].data;
    expect(data.amount.toString()).toBe('21');
  });

  it('skips when no room-charge base entry exists for that day', async () => {
    const { ctx, folioEntryCreate } = buildCtx({
      reservations: [reservation],
      baseEntryAmount: undefined, // no base
    });
    const out = await new PostTaxesStep().run(ctx);
    expect(folioEntryCreate).not.toHaveBeenCalled();
    expect(out.totals?.taxesPosted).toBe(0);
  });

  it('skips when an existing TAX entry already exists (idempotent)', async () => {
    const { ctx, folioEntryCreate } = buildCtx({
      reservations: [reservation],
      baseEntryAmount: '100.00',
      existingTaxEntry: { id: 'already-taxed' },
    });
    await new PostTaxesStep().run(ctx);
    expect(folioEntryCreate).not.toHaveBeenCalled();
  });
});
