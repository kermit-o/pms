import { CityTaxRegion, FolioStatus, Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../auth';
import type { StepContext } from '../step';
import { PostCityTaxStep } from './post-city-tax';

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
const FOLIO_ID = '22222222-2222-2222-2222-222222222222';
const RES_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';
const TENANT_ID = '55555555-5555-5555-5555-555555555555';

const user: AuthUser = {
  sub: USER_ID,
  email: 'na@hotel.test',
  tenantId: TENANT_ID,
  roles: ['night_auditor'],
};

interface RuleOverride {
  amountPerNight?: string;
  appliesToAdults?: boolean;
  appliesToChildren?: boolean;
  childAgeThreshold?: number;
  maxNights?: number;
}

function rule(o: RuleOverride = {}) {
  return {
    propertyId: PROPERTY_ID,
    region: CityTaxRegion.CATALUNYA,
    amountPerNight: new Prisma.Decimal(o.amountPerNight ?? '1.20'),
    appliesToAdults: o.appliesToAdults ?? true,
    appliesToChildren: o.appliesToChildren ?? false,
    childAgeThreshold: o.childAgeThreshold ?? 16,
    maxNights: o.maxNights ?? 7,
  };
}

function buildCtx(opts: {
  rule?: ReturnType<typeof rule> | null;
  reservation?: {
    adults: number;
    children: number;
    folioStatus?: FolioStatus;
  } | null;
  priorCityTaxCount?: number;
  createThrowsUnique?: boolean;
}): { ctx: StepContext; tx: ReturnType<typeof makeTx> } {
  const tx = makeTx(opts);
  const ctx: StepContext = {
    tx: tx as unknown as StepContext['tx'],
    user,
    correlationId: 'corr-1',
    runId: 'run-1',
    propertyId: PROPERTY_ID,
    businessDate: '2026-06-10',
    businessDateAsDate: new Date('2026-06-10T00:00:00Z'),
  };
  return { ctx, tx };
}

function makeTx(opts: {
  rule?: ReturnType<typeof rule> | null;
  reservation?: {
    adults: number;
    children: number;
    folioStatus?: FolioStatus;
  } | null;
  priorCityTaxCount?: number;
  createThrowsUnique?: boolean;
}) {
  const cityTaxRuleFindUnique = vi.fn().mockResolvedValue(opts.rule ?? null);
  const reservationFindMany = vi.fn().mockResolvedValue(
    opts.reservation
      ? [
          {
            id: RES_ID,
            currency: 'EUR',
            adults: opts.reservation.adults,
            children: opts.reservation.children,
            folio: {
              id: FOLIO_ID,
              status: opts.reservation.folioStatus ?? FolioStatus.OPEN,
            },
          },
        ]
      : [],
  );
  const folioEntryCount = vi.fn().mockResolvedValue(opts.priorCityTaxCount ?? 0);
  const folioEntryCreate = vi.fn().mockImplementation(() => {
    if (opts.createThrowsUnique) {
      return Promise.reject(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
    }
    return Promise.resolve({ id: 'entry-1' });
  });
  const folioUpdate = vi.fn().mockResolvedValue({});

  return {
    cityTaxRule: { findUnique: cityTaxRuleFindUnique },
    reservation: { findMany: reservationFindMany },
    folioEntry: { count: folioEntryCount, create: folioEntryCreate },
    folio: { update: folioUpdate },
  };
}

describe('PostCityTaxStep', () => {
  it('sin regla configurada → no postea nada', async () => {
    const { ctx, tx } = buildCtx({ rule: null });
    const out = await new PostCityTaxStep().run(ctx);
    expect(out.result).toMatchObject({ posted: 0 });
    expect(tx.reservation.findMany).not.toHaveBeenCalled();
  });

  it('regla con amountPerNight=0 → no postea', async () => {
    const { ctx } = buildCtx({
      rule: rule({ amountPerNight: '0' }),
      reservation: { adults: 2, children: 0 },
    });
    const out = await new PostCityTaxStep().run(ctx);
    expect(out.result).toMatchObject({ posted: 0, reason: 'no_rule' });
  });

  it('Cataluña 1.20€ × 2 adultos × 1 noche → posted=1 amount=2.40', async () => {
    const { ctx, tx } = buildCtx({
      rule: rule({ amountPerNight: '1.20' }),
      reservation: { adults: 2, children: 0 },
    });
    const out = await new PostCityTaxStep().run(ctx);
    expect(out.result).toMatchObject({
      posted: 1,
      amountTotal: '2.4',
    });
    expect(tx.folioEntry.create).toHaveBeenCalledOnce();
    const data = tx.folioEntry.create.mock.calls[0]![0]!.data;
    expect(data.taxCategory).toBe('CITY_TAX');
    expect(data.amount.toString()).toBe('2.4');
    expect(data.idempotencyKey).toBe(`na:city-tax:2026-06-10:${RES_ID}`);
  });

  it('respeta cap maxNights (7) — noche 8 se skipea', async () => {
    const { ctx, tx } = buildCtx({
      rule: rule({ amountPerNight: '1.20', maxNights: 7 }),
      reservation: { adults: 2, children: 0 },
      priorCityTaxCount: 7,
    });
    const out = await new PostCityTaxStep().run(ctx);
    expect(out.result).toMatchObject({ posted: 0, skippedCap: 1 });
    expect(tx.folioEntry.create).not.toHaveBeenCalled();
  });

  it('maxNights=0 → no aplica cap (postea siempre)', async () => {
    const { ctx, tx } = buildCtx({
      rule: rule({ amountPerNight: '1.20', maxNights: 0 }),
      reservation: { adults: 2, children: 0 },
      priorCityTaxCount: 100,
    });
    const out = await new PostCityTaxStep().run(ctx);
    expect(out.result).toMatchObject({ posted: 1 });
    expect(tx.folioEntry.count).not.toHaveBeenCalled();
  });

  it('children no cobrables → solo adults computan', async () => {
    const { ctx, tx } = buildCtx({
      rule: rule({
        amountPerNight: '1.20',
        appliesToAdults: true,
        appliesToChildren: false,
      }),
      reservation: { adults: 2, children: 3 },
    });
    await new PostCityTaxStep().run(ctx);
    const data = tx.folioEntry.create.mock.calls[0]![0]!.data;
    expect((data.attributes as { chargeablePax: number }).chargeablePax).toBe(2);
    expect(data.amount.toString()).toBe('2.4');
  });

  it('chargeablePax=0 → no postea (familia sólo niños y rule no cubre niños)', async () => {
    const { ctx, tx } = buildCtx({
      rule: rule({
        amountPerNight: '1.20',
        appliesToAdults: false,
        appliesToChildren: false,
      }),
      reservation: { adults: 0, children: 2 },
    });
    const out = await new PostCityTaxStep().run(ctx);
    expect(out.result).toMatchObject({ posted: 0 });
    expect(tx.folioEntry.create).not.toHaveBeenCalled();
  });

  it('folio CLOSED → reserva saltada en skippedNoFolio', async () => {
    const { ctx, tx } = buildCtx({
      rule: rule(),
      reservation: { adults: 2, children: 0, folioStatus: FolioStatus.CLOSED },
    });
    const out = await new PostCityTaxStep().run(ctx);
    expect(out.result).toMatchObject({ posted: 0, skippedNoFolio: 1 });
    expect(tx.folioEntry.create).not.toHaveBeenCalled();
  });

  it('race condition P2002 → no propaga, sólo continúa', async () => {
    const { ctx } = buildCtx({
      rule: rule(),
      reservation: { adults: 2, children: 0 },
      createThrowsUnique: true,
    });
    await expect(new PostCityTaxStep().run(ctx)).resolves.toBeDefined();
  });
});
