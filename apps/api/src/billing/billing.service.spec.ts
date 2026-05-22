import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BillingService } from './billing.service';
import type { AuthUser } from '../auth';

const user: AuthUser = {
  sub: '22222222-2222-2222-2222-222222222222',
  tenantId: '11111111-1111-1111-1111-111111111111',
  email: 'admin@hotel.test',
  roles: ['tenant_admin'],
};

const stripeMock = {
  customers: { create: vi.fn() },
  subscriptions: { create: vi.fn() },
  billingPortal: { sessions: { create: vi.fn() } },
  webhooks: { constructEvent: vi.fn() },
};
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => stripeMock),
}));

function buildService(opts: { tenant?: unknown; secret?: string; priceId?: string; webhookSecret?: string } = {}) {
  const tenant = opts.tenant === undefined
    ? {
        id: user.tenantId,
        name: 'Hotel Test',
        slug: 'hotel-test',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        trialEndsAt: null,
      }
    : opts.tenant;
  const tenantFindUnique = vi.fn().mockResolvedValue(tenant);
  const tenantUpdate = vi.fn().mockResolvedValue(tenant);
  const tenantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    tenant: {
      findUnique: tenantFindUnique,
      update: tenantUpdate,
      updateMany: tenantUpdateMany,
    },
  };
  const config = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return opts.secret ?? 'sk_test_x';
      if (key === 'SAAS_STRIPE_PRICE_ID') return opts.priceId ?? 'price_xxx';
      if (key === 'SAAS_STRIPE_WEBHOOK_SECRET') return opts.webhookSecret ?? 'whsec_x';
      if (key === 'SAAS_TRIAL_DAYS') return 14;
      return undefined;
    }),
  };
  return {
    service: new BillingService(prisma as never, config as never),
    tenantFindUnique,
    tenantUpdate,
    tenantUpdateMany,
  };
}

describe('BillingService.getSubscription', () => {
  it('devuelve hasSubscription=false cuando el tenant no tiene sub', async () => {
    const { service } = buildService();
    const out = await service.getSubscription(user);
    expect(out.hasSubscription).toBe(false);
    expect(out.status).toBeNull();
  });

  it('devuelve status + trialEndsAt cuando hay sub', async () => {
    const { service } = buildService({
      tenant: {
        id: user.tenantId,
        name: 'Hotel',
        slug: 'h',
        stripeCustomerId: 'cus_x',
        stripeSubscriptionId: 'sub_x',
        subscriptionStatus: 'trialing',
        currentPeriodEnd: new Date('2026-08-10T00:00:00Z'),
        trialEndsAt: new Date('2026-07-24T00:00:00Z'),
      },
    });
    const out = await service.getSubscription(user);
    expect(out.hasSubscription).toBe(true);
    expect(out.status).toBe('trialing');
    expect(out.trialEndsAt).toBe('2026-07-24T00:00:00.000Z');
  });
});

describe('BillingService.startSubscription', () => {
  it('crea customer + subscription con trial 14 días', async () => {
    stripeMock.customers.create.mockResolvedValueOnce({ id: 'cus_new' });
    stripeMock.subscriptions.create.mockResolvedValueOnce({
      id: 'sub_new',
      status: 'trialing',
      current_period_end: 1722000000,
      trial_end: 1721000000,
    });
    const { service, tenantUpdate } = buildService();
    // El update tras crear sub devuelve el row con los nuevos valores.
    tenantUpdate.mockResolvedValueOnce({
      id: user.tenantId,
      name: 'Hotel Test',
      stripeCustomerId: 'cus_new',
      stripeSubscriptionId: 'sub_new',
      subscriptionStatus: 'trialing',
      currentPeriodEnd: new Date(1722000000 * 1000),
      trialEndsAt: new Date(1721000000 * 1000),
    });
    const out = await service.startSubscription(user);
    expect(out.hasSubscription).toBe(true);
    expect(out.status).toBe('trialing');
    expect(stripeMock.customers.create).toHaveBeenCalledOnce();
    expect(stripeMock.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_new',
        trial_period_days: 14,
      }),
      expect.objectContaining({ idempotencyKey: `tenant-sub-${user.tenantId}` }),
    );
    expect(tenantUpdate).toHaveBeenCalledOnce();
  });

  it('es idempotente: si ya existe sub, devuelve la actual sin tocar Stripe', async () => {
    const { service } = buildService({
      tenant: {
        id: user.tenantId,
        name: 'h',
        slug: 's',
        stripeCustomerId: 'cus_x',
        stripeSubscriptionId: 'sub_exists',
        subscriptionStatus: 'active',
        currentPeriodEnd: new Date(),
        trialEndsAt: null,
      },
    });
    stripeMock.customers.create.mockClear();
    stripeMock.subscriptions.create.mockClear();
    const out = await service.startSubscription(user);
    expect(out.status).toBe('active');
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
  });

  it('503 si STRIPE_SECRET_KEY no está configurado', async () => {
    const { service } = buildService({ secret: '' });
    await expect(service.startSubscription(user)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('503 si SAAS_STRIPE_PRICE_ID no está configurado', async () => {
    const { service } = buildService({ priceId: '' });
    await expect(service.startSubscription(user)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('BillingService.createPortalSession', () => {
  it('lanza 400 cuando el tenant no tiene customer', async () => {
    const { service } = buildService();
    await expect(
      service.createPortalSession(user, 'https://aubergine.test/admin/billing'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('devuelve la URL del portal cuando hay customer', async () => {
    stripeMock.billingPortal.sessions.create.mockResolvedValueOnce({
      url: 'https://billing.stripe.com/p/session_x',
    });
    const { service } = buildService({
      tenant: {
        id: user.tenantId,
        name: 'h',
        slug: 's',
        stripeCustomerId: 'cus_x',
        stripeSubscriptionId: 'sub_x',
        subscriptionStatus: 'active',
        currentPeriodEnd: null,
        trialEndsAt: null,
      },
    });
    const out = await service.createPortalSession(user, 'https://aubergine.test/admin/billing');
    expect(out.url).toContain('billing.stripe.com');
  });
});

describe('BillingService.handleWebhook', () => {
  it('sincroniza status en subscription.updated', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_x',
          status: 'past_due',
          current_period_end: 1722000000,
          trial_end: null,
          metadata: { tenantId: user.tenantId },
        },
      },
    });
    const { service, tenantUpdateMany } = buildService();
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.type).toBe('customer.subscription.updated');
    expect(tenantUpdateMany).toHaveBeenCalledOnce();
    const data = tenantUpdateMany.mock.calls[0]![0]!.data;
    expect(data.subscriptionStatus).toBe('past_due');
  });

  it('ignora subscription sin metadata.tenantId (no rompe)', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: { id: 'sub_x', status: 'active', metadata: {} },
      },
    });
    const { service, tenantUpdateMany } = buildService();
    const out = await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(out.type).toBe('customer.subscription.updated');
    expect(tenantUpdateMany).not.toHaveBeenCalled();
  });
});
