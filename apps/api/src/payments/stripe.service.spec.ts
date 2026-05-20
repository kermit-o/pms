import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { StripeService } from './stripe.service';
import type { AuthUser } from '../auth';

const user: AuthUser = {
  sub: '22222222-2222-2222-2222-222222222222',
  tenantId: '11111111-1111-1111-1111-111111111111',
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};
const RES_ID = '33333333-3333-3333-3333-333333333333';

const stripeMock = {
  paymentIntents: {
    create: vi.fn(),
  },
  setupIntents: { retrieve: vi.fn(), create: vi.fn() },
  paymentMethods: { retrieve: vi.fn() },
  webhooks: { constructEvent: vi.fn() },
  customers: { create: vi.fn() },
};
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => stripeMock),
}));

function buildService(
  options: {
    reservation?: unknown;
    existingFolioEntry?: unknown;
  } = {},
) {
  const folio = {
    addCharge: vi.fn().mockResolvedValue({
      entryId: 'fe-1',
      balance: '100.00',
      deduplicated: false,
    }),
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        reservation: {
          findFirst: vi.fn().mockResolvedValue(
            options.reservation ?? {
              id: RES_ID,
              code: 'BBM01-X',
              status: 'NO_SHOW',
              currency: 'EUR',
              stripeCustomerId: 'cus_x',
              stripePaymentMethodId: 'pm_x',
              stripeCardBrand: 'visa',
              stripeCardLast4: '4242',
              folio: { id: 'f-1', status: 'OPEN', currency: 'EUR' },
            },
          ),
        },
        folioEntry: {
          findFirst: vi.fn().mockResolvedValue(options.existingFolioEntry ?? null),
          update: vi.fn().mockResolvedValue({}),
        },
      }),
    ),
  };
  const config = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_x';
      if (key === 'STRIPE_PUBLISHABLE_KEY') return 'pk_test_x';
      return undefined;
    }),
  };
  return {
    service: new StripeService(prisma as never, folio as never, config as never),
    folio,
  };
}

describe('StripeService.chargeNoShow', () => {
  it('rejects amount <= 0', async () => {
    const { service } = buildService();
    await expect(
      service.chargeNoShow(user, 'cid', RES_ID, { amount: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns already_charged when an entry with the idempotency key exists', async () => {
    const { service, folio } = buildService({
      existingFolioEntry: {
        id: 'fe-existing',
        attributes: { stripePaymentIntentId: 'pi_existing' },
      },
    });
    const out = await service.chargeNoShow(user, 'cid', RES_ID, { amount: 100 });
    expect(out).toEqual({
      status: 'already_charged',
      paymentIntentId: 'pi_existing',
      folioEntryId: 'fe-existing',
    });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(folio.addCharge).not.toHaveBeenCalled();
  });

  it('happy path: creates PaymentIntent succeeded and posts folio charge', async () => {
    stripeMock.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_new',
      status: 'succeeded',
      latest_charge: 'ch_new',
    });
    const { service, folio } = buildService();
    const out = await service.chargeNoShow(user, 'cid', RES_ID, { amount: 100 });
    expect(out.status).toBe('succeeded');
    expect(out.paymentIntentId).toBe('pi_new');
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10000,
        currency: 'eur',
        customer: 'cus_x',
        payment_method: 'pm_x',
        off_session: true,
        confirm: true,
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining(RES_ID) }),
    );
    expect(folio.addCharge).toHaveBeenCalledOnce();
  });

  it('returns requires_action when Stripe pide SCA', async () => {
    stripeMock.paymentIntents.create.mockRejectedValueOnce({
      code: 'authentication_required',
      message: 'auth required',
      payment_intent: { id: 'pi_auth', status: 'requires_action' },
    });
    const { service, folio } = buildService();
    const out = await service.chargeNoShow(user, 'cid', RES_ID, { amount: 50 });
    expect(out.status).toBe('requires_action');
    expect(out.paymentIntentId).toBe('pi_auth');
    expect(folio.addCharge).not.toHaveBeenCalled();
  });

  it('rejects reservas sin tarjeta tokenizada', async () => {
    const { service } = buildService({
      reservation: {
        id: RES_ID,
        code: 'X',
        status: 'NO_SHOW',
        currency: 'EUR',
        stripeCustomerId: null,
        stripePaymentMethodId: null,
        stripeCardBrand: null,
        stripeCardLast4: null,
        folio: { id: 'f', status: 'OPEN', currency: 'EUR' },
      },
    });
    await expect(
      service.chargeNoShow(user, 'cid', RES_ID, { amount: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Sprint 11 W3 — Webhook hardening
// ---------------------------------------------------------------------------

import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

function buildServiceForWebhook(opts: { secret?: string } = {}) {
  const folio = {
    addCharge: vi.fn(),
  };
  const reservationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    reservation: { updateMany: reservationUpdateMany },
    withTenant: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_x';
      if (key === 'STRIPE_PUBLISHABLE_KEY') return 'pk_test_x';
      if (key === 'STRIPE_WEBHOOK_SECRET') return opts.secret ?? 'whsec_test_x';
      return undefined;
    }),
  };
  return {
    service: new StripeService(prisma as never, folio as never, config as never),
    prisma,
    reservationUpdateMany,
  };
}

describe('StripeService.handleWebhook (S11 W3 hardening)', () => {
  it('throws 503 when webhook secret missing', async () => {
    const { service } = buildServiceForWebhook({ secret: '' });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws 403 when signature header is absent (no longer 400)', async () => {
    const { service } = buildServiceForWebhook();
    await expect(
      service.handleWebhook(Buffer.from('{}'), undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 403 when signature does not verify', async () => {
    const { service } = buildServiceForWebhook();
    stripeMock.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching');
    });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('handles setup_intent.succeeded and updates the reservation', async () => {
    const { service, reservationUpdateMany } = buildServiceForWebhook();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'setup_intent.succeeded',
      created: Math.floor(Date.now() / 1000) - 5,
      data: {
        object: {
          id: 'seti_1',
          payment_method: 'pm_card_visa',
          metadata: {
            reservationId: RES_ID,
            tenantId: '11111111-1111-1111-1111-111111111111',
          },
        },
      },
    });
    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2027 },
    });
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out).toEqual({ ok: true, type: 'setup_intent.succeeded', outcome: 'handled' });
    expect(reservationUpdateMany).toHaveBeenCalledOnce();
    const data = reservationUpdateMany.mock.calls[0]![0]!.data;
    expect(data.guaranteeStatus).toBe('SECURED');
    expect(data.stripeCardBrand).toBe('visa');
  });

  it('returns outcome=unknown_type for events we do not handle', async () => {
    const { service, reservationUpdateMany } = buildServiceForWebhook();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.outcome).toBe('unknown_type');
    expect(reservationUpdateMany).not.toHaveBeenCalled();
  });

  it('payment_intent.succeeded with kind != reservation_charge is a noop', async () => {
    const { service, reservationUpdateMany } = buildServiceForWebhook();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'pi_1', metadata: { kind: 'no_show_charge' } } },
    });
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.outcome).toBe('handled');
    expect(reservationUpdateMany).not.toHaveBeenCalled();
  });

  it('setup_intent without metadata is a noop, not an error', async () => {
    const { service, reservationUpdateMany } = buildServiceForWebhook();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'setup_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'seti_2', payment_method: 'pm_x', metadata: {} } },
    });
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.outcome).toBe('handled');
    expect(reservationUpdateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sprint 12 W3 — Pre-pago full PaymentIntent on-session
// ---------------------------------------------------------------------------

function buildServiceForPI(opts: { reservation?: unknown; folio?: unknown; existingEntry?: unknown } = {}) {
  const reservationFindFirst = vi.fn().mockResolvedValue(
    opts.reservation ?? {
      id: RES_ID,
      code: 'BCN-PI',
      totalAmount: '120.00',
      currency: 'EUR',
      stripeCustomerId: 'cus_pi',
      guests: [{ guest: { firstName: 'A', lastName: 'B', email: 'a@b.test', phone: null } }],
    },
  );
  const reservationUpdate = vi.fn().mockResolvedValue({});
  const reservationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const folioFindFirst = vi.fn().mockResolvedValue(
    opts.folio ?? { id: 'f-1', balance: '120.00', currency: 'EUR', status: 'OPEN' },
  );
  const folioEntryFindFirst = vi.fn().mockResolvedValue(opts.existingEntry ?? null);
  const transactionFn = vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({
      folioEntry: { create: vi.fn().mockResolvedValue({ id: 'fe-new' }) },
      folio: { update: vi.fn().mockResolvedValue({}) },
    }),
  );
  const prisma = {
    withTenant: vi.fn(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        reservation: { findFirst: reservationFindFirst, update: reservationUpdate },
      }),
    ),
    reservation: { updateMany: reservationUpdateMany },
    folio: { findFirst: folioFindFirst },
    folioEntry: { findFirst: folioEntryFindFirst },
    $transaction: transactionFn,
  };
  const folio = { addCharge: vi.fn() };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_x';
      if (key === 'STRIPE_PUBLISHABLE_KEY') return 'pk_test_x';
      if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test_x';
      return undefined;
    }),
  };
  return {
    service: new StripeService(prisma as never, folio as never, config as never),
    prisma,
    reservationUpdateMany,
    folioEntryFindFirst,
    transactionFn,
  };
}

describe('StripeService.createPaymentIntent (S12 W3)', () => {
  it('creates PI with totalAmount * 100 cents and idempotencyKey', async () => {
    const { service } = buildServiceForPI();
    stripeMock.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_new',
      client_secret: 'pi_new_secret_x',
    });
    const out = await service.createPaymentIntent(user, 'cid', RES_ID);
    expect(out.clientSecret).toBe('pi_new_secret_x');
    expect(out.publishableKey).toBe('pk_test_x');
    expect(out.paymentIntentId).toBe('pi_new');
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12000,
        currency: 'eur',
        customer: 'cus_pi',
        payment_method_types: ['card'],
        metadata: expect.objectContaining({ reservationId: RES_ID, kind: 'reservation_charge' }),
      }),
      expect.objectContaining({ idempotencyKey: `pi-charge-${RES_ID}` }),
    );
  });

  it('rejects reservations with no totalAmount', async () => {
    const { service } = buildServiceForPI({
      reservation: {
        id: RES_ID,
        code: 'X',
        totalAmount: '0.00',
        currency: 'EUR',
        stripeCustomerId: 'cus_x',
        guests: [],
      },
    });
    await expect(service.createPaymentIntent(user, 'cid', RES_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('StripeService.handleWebhook payment_intent.succeeded (S12 W3)', () => {
  it('marks reservation SECURED + posts folio PAYMENT entry idempotently', async () => {
    const { service, reservationUpdateMany, transactionFn } = buildServiceForPI();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_ok',
          amount: 12000,
          payment_method: 'pm_card_visa',
          latest_charge: 'ch_ok',
          metadata: {
            kind: 'reservation_charge',
            reservationId: RES_ID,
            tenantId: '11111111-1111-1111-1111-111111111111',
          },
        },
      },
    });
    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
    });
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.outcome).toBe('handled');
    expect(reservationUpdateMany).toHaveBeenCalledOnce();
    expect(transactionFn).toHaveBeenCalledOnce();
  });

  it('skips folio insert when an entry with idempotencyKey already exists', async () => {
    const { service, transactionFn } = buildServiceForPI({
      existingEntry: { id: 'fe-dup' },
    });
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_dup',
          amount: 12000,
          payment_method: 'pm_x',
          metadata: {
            kind: 'reservation_charge',
            reservationId: RES_ID,
            tenantId: '11111111-1111-1111-1111-111111111111',
          },
        },
      },
    });
    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({ card: null });
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.outcome).toBe('handled');
    expect(transactionFn).not.toHaveBeenCalled();
  });
});
