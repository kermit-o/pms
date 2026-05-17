import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { GuaranteeStatus, GuaranteeType } from '@pms/db';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';

/**
 * Stripe Setup Intent flow (Corte B garantía).
 *
 * - createSetupIntent: crea o reusa Customer y SetupIntent → devuelve
 *   client_secret + publishableKey para que la web monte Stripe Elements.
 * - handleWebhook: procesa setup_intent.succeeded → marca SECURED + guarda
 *   payment_method_id y últimos 4.
 *
 * Si la key no está configurada, los métodos lanzan 503; el operador sigue
 * pudiendo usar el flujo manual de "Marcar garantía OK".
 */
@Injectable()
export class StripeService {
  private readonly log = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly publishableKey: string | undefined;
  private readonly webhookSecret: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    const secret = this.config.get('STRIPE_SECRET_KEY', { infer: true });
    this.publishableKey = this.config.get('STRIPE_PUBLISHABLE_KEY', { infer: true });
    this.webhookSecret = this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
    this.stripe = secret ? new Stripe(secret) : null;
    this.log.log(
      `Stripe init: ${this.stripe ? 'live (' + (secret?.startsWith('sk_test_') ? 'TEST' : 'LIVE') + ')' : 'disabled'}`,
    );
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe no configurado. Setea STRIPE_SECRET_KEY o usa garantía manual.',
      );
    }
    return this.stripe;
  }

  getPublishableKey(): string | null {
    return this.publishableKey ?? null;
  }

  /**
   * Crea (o reusa) Customer + SetupIntent para la reserva. Devuelve el
   * client_secret que la web pasa a Stripe Elements.
   */
  async createSetupIntent(
    user: AuthUser,
    correlationId: string,
    reservationId: string,
  ): Promise<{ clientSecret: string; publishableKey: string }> {
    const stripe = this.requireStripe();
    const pk = this.publishableKey;
    if (!pk) {
      throw new ServiceUnavailableException('STRIPE_PUBLISHABLE_KEY no configurada');
    }

    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    return this.prisma.withTenant(ctx, async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id: reservationId, deletedAt: null },
        select: {
          id: true,
          code: true,
          stripeCustomerId: true,
          stripeSetupIntentId: true,
          guests: {
            where: { isPrimary: true },
            take: 1,
            select: {
              guest: { select: { firstName: true, lastName: true, email: true, phone: true } },
            },
          },
        },
      });
      if (!reservation) throw new NotFoundException(`Reservation ${reservationId} not found`);

      const primary = reservation.guests[0]?.guest;

      // Customer reuse si ya existía, crear uno nuevo si no.
      let customerId = reservation.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: primary ? `${primary.firstName} ${primary.lastName}`.trim() : reservation.code,
          email: primary?.email ?? undefined,
          phone: primary?.phone ?? undefined,
          metadata: {
            reservationId: reservation.id,
            reservationCode: reservation.code,
            tenantId: user.tenantId,
          },
        });
        customerId = customer.id;
      }

      // SetupIntent reuse si ya hay uno y no se completó.
      let intent: Stripe.SetupIntent;
      if (reservation.stripeSetupIntentId) {
        intent = await stripe.setupIntents.retrieve(reservation.stripeSetupIntentId);
        if (intent.status === 'succeeded' || intent.status === 'canceled') {
          // Crea uno nuevo si el viejo ya está cerrado.
          intent = await stripe.setupIntents.create({
            customer: customerId,
            usage: 'off_session',
            payment_method_types: ['card'],
            metadata: {
              reservationId: reservation.id,
              reservationCode: reservation.code,
              tenantId: user.tenantId,
            },
          });
        }
      } else {
        intent = await stripe.setupIntents.create({
          customer: customerId,
          usage: 'off_session',
          payment_method_types: ['card'],
          metadata: {
            reservationId: reservation.id,
            reservationCode: reservation.code,
            tenantId: user.tenantId,
          },
        });
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          stripeCustomerId: customerId,
          stripeSetupIntentId: intent.id,
          guaranteeType: GuaranteeType.CARD_ON_FILE,
        },
      });

      if (!intent.client_secret) {
        throw new BadRequestException('Stripe no devolvió client_secret');
      }
      return { clientSecret: intent.client_secret, publishableKey: pk };
    });
  }

  /**
   * Confirmación lado cliente (fallback al webhook). Cuando el frontend
   * recibe setup_intent.status === 'succeeded' del confirmSetup, llama
   * aquí para que server-side traiga el SI desde Stripe (verificación
   * de verdad) y actualice la reserva.
   *
   * Esto evita depender del webhook si no es viable (cuentas con eventos
   * restringidos, ngrok local, etc.). El webhook sigue siendo el path
   * autoritativo en producción; este endpoint es idempotente.
   */
  async confirmSetupIntent(
    user: AuthUser,
    correlationId: string,
    reservationId: string,
  ): Promise<{ status: GuaranteeStatus; brand: string | null; last4: string | null }> {
    const stripe = this.requireStripe();
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    return this.prisma.withTenant(ctx, async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id: reservationId, deletedAt: null },
        select: { id: true, stripeSetupIntentId: true, guaranteeStatus: true },
      });
      if (!reservation) throw new NotFoundException(`Reservation ${reservationId} not found`);
      if (!reservation.stripeSetupIntentId) {
        throw new BadRequestException('No SetupIntent activo en esta reserva');
      }

      const si = await stripe.setupIntents.retrieve(reservation.stripeSetupIntentId);
      if (si.status !== 'succeeded') {
        // No marcamos SECURED aún. El operador puede reintentar.
        return {
          status: reservation.guaranteeStatus,
          brand: null,
          last4: null,
        };
      }

      const paymentMethodId =
        typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
      let card: Stripe.PaymentMethod.Card | null = null;
      if (paymentMethodId) {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        card = pm.card ?? null;
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          stripePaymentMethodId: paymentMethodId ?? null,
          stripeCardBrand: card?.brand ?? null,
          stripeCardLast4: card?.last4 ?? null,
          stripeCardExpMonth: card?.exp_month ?? null,
          stripeCardExpYear: card?.exp_year ?? null,
          guaranteeStatus: GuaranteeStatus.SECURED,
          guaranteeSecuredAt: new Date(),
          guaranteeReference: card?.last4 ? `**** ${card.last4} (${card.brand})` : 'stripe',
          guaranteeDeadline: null,
        },
      });

      return {
        status: GuaranteeStatus.SECURED,
        brand: card?.brand ?? null,
        last4: card?.last4 ?? null,
      };
    });
  }

  /**
   * Webhook handler. Solo procesamos setup_intent.succeeded por ahora —
   * marca la reserva SECURED y guarda los datos visibles de la tarjeta.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ ok: true }> {
    const stripe = this.requireStripe();
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET no configurado');
    }
    if (!signature) throw new BadRequestException('missing stripe-signature');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      this.log.error(`Webhook signature mismatch: ${(err as Error).message}`);
      throw new BadRequestException('signature mismatch');
    }

    if (event.type === 'setup_intent.succeeded') {
      const si = event.data.object as Stripe.SetupIntent;
      const reservationId = si.metadata?.reservationId;
      const tenantId = si.metadata?.tenantId;
      if (!reservationId || !tenantId) {
        this.log.warn(`SetupIntent ${si.id} sin metadata.reservationId/tenantId`);
        return { ok: true };
      }
      const paymentMethodId =
        typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
      let card: Stripe.PaymentMethod.Card | null = null;
      if (paymentMethodId) {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        card = pm.card ?? null;
      }

      // No tenemos el usuario en el webhook → bypaseamos withTenant con un
      // query directo. El reservationId+tenantId vienen del metadata que
      // nosotros mismos pusimos, así que es seguro.
      await this.prisma.reservation.updateMany({
        where: { id: reservationId, tenantId },
        data: {
          stripePaymentMethodId: paymentMethodId ?? null,
          stripeCardBrand: card?.brand ?? null,
          stripeCardLast4: card?.last4 ?? null,
          stripeCardExpMonth: card?.exp_month ?? null,
          stripeCardExpYear: card?.exp_year ?? null,
          guaranteeStatus: GuaranteeStatus.SECURED,
          guaranteeSecuredAt: new Date(),
          guaranteeReference: card?.last4 ? `**** ${card.last4} (${card.brand})` : 'stripe',
          guaranteeDeadline: null,
        },
      });
      this.log.log(`SetupIntent ${si.id} succeeded → reservation ${reservationId} SECURED`);
    }

    return { ok: true };
  }
}
