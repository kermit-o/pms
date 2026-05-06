import { FolioStatus, Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { StepContext } from '../step';
import { PostPackagesStep } from './post-packages';

const RES_ID = '11111111-1111-1111-1111-111111111111';
const FOLIO_ID = '22222222-2222-2222-2222-222222222222';

function buildCtx(opts: { reservations?: unknown[]; existingPkgEntry?: { id: string } | null }) {
  const reservationFindMany = vi.fn().mockResolvedValue(opts.reservations ?? []);
  const folioEntryFindFirst = vi.fn().mockResolvedValue(opts.existingPkgEntry ?? null);
  const folioEntryCreate = vi.fn().mockResolvedValue({ id: 'pkg-entry' });
  const folioUpdate = vi.fn().mockResolvedValue({});

  const tx = {
    reservation: { findMany: reservationFindMany },
    folioEntry: {
      findFirst: folioEntryFindFirst,
      create: folioEntryCreate,
    },
    folio: { update: folioUpdate },
  } as unknown as StepContext['tx'];

  const ctx: StepContext = {
    tx,
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

describe('PostPackagesStep', () => {
  it('posts one CHARGE per declared package, perGuest multiplier honored', async () => {
    const { ctx, folioEntryCreate } = buildCtx({
      reservations: [
        {
          id: RES_ID,
          adults: 2,
          children: 1,
          currency: 'EUR',
          ratePlan: {
            attributes: {
              packages: [
                { code: 'BB', name: 'Breakfast', amount: '8.50', perGuest: true },
                { code: 'PARK', name: 'Parking', amount: 12 },
              ],
            },
          },
          folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
        },
      ],
    });

    const out = await new PostPackagesStep().run(ctx);
    expect(folioEntryCreate).toHaveBeenCalledTimes(2);

    const breakfast = folioEntryCreate.mock.calls[0]![0].data;
    expect(breakfast.idempotencyKey).toBe(`na:pkg:2026-06-10:${RES_ID}:BB`);
    // 8.50 × (2 adults + 1 child) = 25.50
    expect(breakfast.amount.toString()).toBe('25.5');

    const parking = folioEntryCreate.mock.calls[1]![0].data;
    expect(parking.idempotencyKey).toBe(`na:pkg:2026-06-10:${RES_ID}:PARK`);
    expect(parking.amount.toString()).toBe('12');

    expect(out.totals?.packagesPosted).toBe(2);
  });

  it('skips when ratePlan has no packages array', async () => {
    const { ctx, folioEntryCreate } = buildCtx({
      reservations: [
        {
          id: RES_ID,
          adults: 1,
          children: 0,
          currency: 'EUR',
          ratePlan: { attributes: null },
          folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
        },
      ],
    });
    const out = await new PostPackagesStep().run(ctx);
    expect(folioEntryCreate).not.toHaveBeenCalled();
    expect(out.totals?.packagesPosted).toBe(0);
  });

  it('skips an individual package when its idempotency entry already exists', async () => {
    const { ctx, folioEntryCreate } = buildCtx({
      reservations: [
        {
          id: RES_ID,
          adults: 2,
          children: 0,
          currency: 'EUR',
          ratePlan: {
            attributes: {
              packages: [{ code: 'BB', name: 'Breakfast', amount: 10 }],
            },
          },
          folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
        },
      ],
      existingPkgEntry: { id: 'already' },
    });
    await new PostPackagesStep().run(ctx);
    expect(folioEntryCreate).not.toHaveBeenCalled();
  });
});

// Imported for the type but unused at runtime; mirrors the pattern in
// other step specs.
void Prisma;
