import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';

/**
 * Sprint 14 W1 — Stripe Billing al tenant. El SaaS cobra al hotel
 * por usar Aubergine (separado del cobro al huésped, que vive en
 * `payments/stripe.service.ts`).
 *
 * Flujo V1:
 *  1. Operador admin entra a /admin/billing → "Empezar trial".
 *  2. Backend crea Customer + Subscription en Stripe (trial 14d default).
 *     Persiste `stripe_customer_id`, `stripe_subscription_id`,
 *     `subscription_status='trialing'`, `trial_ends_at`.
 *  3. Para gestionar (cambiar tarjeta, ver facturas, cancelar), el
 *     operador entra al Stripe Customer Portal — UI hosted, no
 *     reimplementamos.
 *  4. Webhook sincroniza status en tiempo real (trialing →
 *     active → past_due → canceled).
 *
 * V1 no bloquea: si `subscription_status` queda en past_due o
 * canceled, el back-office sigue funcionando con un banner. V2
 * añadirá degradación de servicios; lo dejamos para cuando un
 * piloto lo pida.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;
  private readonly priceId: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly trialDays: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const secret = config.get('STRIPE_SECRET_KEY', { infer: true });
    this.stripe = secret ? new Stripe(secret) : null;
    this.priceId = config.get('SAAS_STRIPE_PRICE_ID', { infer: true });
    this.webhookSecret = config.get('SAAS_STRIPE_WEBHOOK_SECRET', { infer: true });
    this.trialDays = config.get('SAAS_TRIAL_DAYS', { infer: true });
    this.log.log(
      `Billing init: ${this.stripe ? 'live' : 'disabled'} · trialDays=${this.trialDays} · priceId=${this.priceId ?? 'unset'}`,
    );
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe Billing no configurado (STRIPE_SECRET_KEY ausente).',
      );
    }
    return this.stripe;
  }

  /**
   * Devuelve el estado actual de la suscripción del tenant del user.
   * Si nunca se ha creado, devuelve `status: null` para que la UI
   * muestre el CTA "Empezar trial".
   */
  async getSubscription(user: AuthUser): Promise<TenantSubscription> {
    const tenant = await this.prisma.withTenant({ tenantId: user.tenantId }, (tx) =>
      tx.tenant.findUnique({
        where: { id: user.tenantId },
        select: {
          id: true,
          name: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          subscriptionStatus: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
        },
      }),
    );
    if (!tenant) throw new BadRequestException('Tenant not found');
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      hasSubscription: !!tenant.stripeSubscriptionId,
      status: tenant.subscriptionStatus,
      currentPeriodEnd: tenant.currentPeriodEnd?.toISOString() ?? null,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    };
  }

  /**
   * Crea Customer + Subscription en Stripe con trial. Idempotente
   * por tenantId: si ya existe `stripe_subscription_id`, devuelve el
   * actual sin recrear. Para cambios de plan se usa Customer Portal.
   */
  async startSubscription(user: AuthUser): Promise<TenantSubscription> {
    const stripe = this.requireStripe();
    if (!this.priceId) {
      throw new ServiceUnavailableException(
        'SAAS_STRIPE_PRICE_ID no configurado. Configúralo en Stripe Dashboard primero.',
      );
    }

    const tenant = await this.prisma.withTenant({ tenantId: user.tenantId }, (tx) =>
      tx.tenant.findUnique({
        where: { id: user.tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          subscriptionStatus: true,
        },
      }),
    );
    if (!tenant) throw new BadRequestException('Tenant not found');
    if (tenant.stripeSubscriptionId) {
      // Ya existe — devuelve el estado actual sin tocar Stripe.
      return this.getSubscription(user);
    }

    // 1. Customer reuse o crear.
    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: tenant.name,
        metadata: {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        },
      });
      customerId = customer.id;
    }

    // 2. Subscription con trial.
    const subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: this.priceId }],
        trial_period_days: this.trialDays > 0 ? this.trialDays : undefined,
        metadata: {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        },
        // Cuando termina el trial sin payment_method, Stripe marca
        // `past_due`. La UI mostrará banner pidiendo añadir tarjeta.
        trial_settings: {
          end_behavior: { missing_payment_method: 'pause' },
        },
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
      },
      { idempotencyKey: `tenant-sub-${tenant.id}` },
    );

    // 3. Persistir.
    const updated = await this.prisma.withTenant({ tenantId: user.tenantId }, (tx) =>
      tx.tenant.update({
        where: { id: tenant.id },
        data: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
          trialEndsAt: subscription.trial_end
            ? new Date(subscription.trial_end * 1000)
            : null,
        },
        select: {
          id: true,
          name: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          subscriptionStatus: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
        },
      }),
    );
    this.log.log(
      `Subscription created tenant=${tenant.id} sub=${subscription.id} status=${subscription.status}`,
    );
    return {
      tenantId: updated.id,
      tenantName: updated.name,
      hasSubscription: true,
      status: updated.subscriptionStatus,
      currentPeriodEnd: updated.currentPeriodEnd?.toISOString() ?? null,
      trialEndsAt: updated.trialEndsAt?.toISOString() ?? null,
    };
  }

  /**
   * Genera URL del Stripe Customer Portal (UI hosted: cambiar
   * tarjeta, ver facturas, cancelar). Requiere `stripe_customer_id`
   * ya creado.
   */
  async createPortalSession(user: AuthUser, returnUrl: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const tenant = await this.prisma.withTenant({ tenantId: user.tenantId }, (tx) =>
      tx.tenant.findUnique({
        where: { id: user.tenantId },
        select: { stripeCustomerId: true },
      }),
    );
    if (!tenant?.stripeCustomerId) {
      throw new BadRequestException(
        'No subscription. Empieza con "Activar suscripción" antes de abrir el portal.',
      );
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  /**
   * Webhook handler. Procesa eventos de subscription/invoice y
   * sincroniza el status en DB. Identifica el tenant por
   * `subscription.metadata.tenantId` (que pusimos al crear) — más
   * robusto que por customer.id ante deletions.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ ok: true; type: string }> {
    const stripe = this.requireStripe();
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException('SAAS_STRIPE_WEBHOOK_SECRET no configurado');
    }
    if (!signature) throw new ForbiddenException('missing_stripe_signature');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      this.log.warn(`billing.webhook bad_signature: ${(err as Error).message}`);
      throw new ForbiddenException('signature_mismatch');
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.trial_will_end':
      case 'customer.subscription.deleted':
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        // Stripe marca la sub como past_due automáticamente — el
        // siguiente `subscription.updated` lo recoge.
        this.log.warn(
          `invoice.payment_failed sub=${(event.data.object as Stripe.Invoice).subscription}`,
        );
        break;
      default:
        this.log.log(`billing.webhook event=${event.type} ignored`);
    }
    return { ok: true, type: event.type };
  }

  private async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    const tenantId = sub.metadata?.tenantId;
    if (!tenantId) {
      this.log.warn(`Subscription ${sub.id} sin metadata.tenantId — ignored`);
      return;
    }
    await this.prisma.withTenant({ tenantId }, (tx) =>
      tx.tenant.updateMany({
        where: { id: tenantId },
        data: {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : null,
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        },
      }),
    );
    this.log.log(`Subscription sync tenant=${tenantId} status=${sub.status}`);
  }
}

export interface TenantSubscription {
  tenantId: string;
  tenantName: string;
  hasSubscription: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}
