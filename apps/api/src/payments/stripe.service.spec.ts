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
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.outcome).toBe('unknown_type');
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
