import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { FolioStatus, GuaranteeStatus, GuaranteeType, Prisma } from '@pms/db';
import { FolioService } from '../folio';
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
    private readonly folio: FolioService,
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

  /**
   * Stripe Fase 2 — cobro off-session de no-show contra la tarjeta ya
   * tokenizada en Fase 1. Crea un PaymentIntent con `off_session: true` y
   * `confirm: true`. Si el banco pide SCA (raro pero posible incluso con
   * tarjetas previamente verificadas), devolvemos `requires_action` y el
   * operador debe rehacer la captura on-session.
   *
   * Idempotencia: el folio entry se posta con `idempotencyKey =
   * stripe-no-show-{reservationId}`. Llamadas repetidas devuelven el
   * mismo entry sin duplicar cargo, y antes de pedir un PaymentIntent
   * nuevo verificamos si ya existe.
   *
   * Decisión de diseño: no guardamos el PaymentIntent.id en la reserva
   * — vive en `folio_entries.attributes.stripePaymentIntentId`. Si hace
   * falta consultarlo se busca por idempotencyKey.
   */
  async chargeNoShow(
    user: AuthUser,
    correlationId: string,
    reservationId: string,
    input: { amount: number; description?: string },
  ): Promise<{
    status: 'succeeded' | 'requires_action' | 'already_charged' | 'failed';
    paymentIntentId: string | null;
    folioEntryId: string | null;
    error?: string;
  }> {
    const stripe = this.requireStripe();
    if (input.amount <= 0) {
      throw new BadRequestException('amount must be > 0');
    }
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const idempotencyKey = `stripe-no-show-${reservationId}`;

    const reservation = await this.prisma.withTenant(ctx, (tx) =>
      tx.reservation.findFirst({
        where: { id: reservationId, deletedAt: null },
        select: {
          id: true,
          code: true,
          status: true,
          currency: true,
          stripeCustomerId: true,
          stripePaymentMethodId: true,
          stripeCardBrand: true,
          stripeCardLast4: true,
          folio: { select: { id: true, status: true, currency: true } },
        },
      }),
    );
    if (!reservation) throw new NotFoundException(`Reservation ${reservationId} not found`);
    if (!reservation.stripePaymentMethodId || !reservation.stripeCustomerId) {
      throw new BadRequestException(
        'Reserva sin tarjeta tokenizada. Captura tarjeta (Fase 1) antes de cobrar no-show.',
      );
    }
    if (!reservation.folio || reservation.folio.status !== FolioStatus.OPEN) {
      throw new ConflictException('Folio cerrado o inexistente — no se puede cargar.');
    }

    // Si ya hay un cargo con esta idempotencyKey, no llamamos a Stripe.
    const existing = await this.prisma.withTenant(ctx, (tx) =>
      tx.folioEntry.findFirst({
        where: { folioId: reservation.folio!.id, idempotencyKey },
        select: { id: true, attributes: true },
      }),
    );
    if (existing) {
      const attrs = (existing.attributes ?? {}) as { stripePaymentIntentId?: string };
      return {
        status: 'already_charged',
        paymentIntentId: attrs.stripePaymentIntentId ?? null,
        folioEntryId: existing.id,
      };
    }

    const amountCents = Math.round(input.amount * 100);
    const currency = (reservation.folio.currency ?? 'EUR').toLowerCase();
    const description = input.description ?? `No-show ${reservation.code}`;
    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          customer: reservation.stripeCustomerId,
          payment_method: reservation.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          description,
          metadata: {
            reservationId: reservation.id,
            reservationCode: reservation.code,
            tenantId: user.tenantId,
            kind: 'no_show_charge',
          },
        },
        { idempotencyKey: `pi-${idempotencyKey}` },
      );
    } catch (err) {
      const e = err as Stripe.errors.StripeError;
      // El SDK lanza cuando el cargo falla — el PI viene en err.payment_intent.
      const piFromErr = (e as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
      const isAuthRequired =
        e?.code === 'authentication_required' ||
        piFromErr?.status === 'requires_action' ||
        piFromErr?.status === 'requires_payment_method';
      this.log.warn(`No-show charge failed ${reservationId}: ${e.code} ${e.message}`);
      return {
        status: isAuthRequired ? 'requires_action' : 'failed',
        paymentIntentId: piFromErr?.id ?? null,
        folioEntryId: null,
        error: e.message,
      };
    }

    if (pi.status !== 'succeeded') {
      return {
        status: pi.status === 'requires_action' ? 'requires_action' : 'failed',
        paymentIntentId: pi.id,
        folioEntryId: null,
        error: `PaymentIntent status=${pi.status}`,
      };
    }

    // Post folio entry vía FolioService (idempotente por idempotencyKey).
    const charge = await this.folio.addCharge(user, correlationId, reservation.folio.id, {
      description: `${description} (Stripe ${reservation.stripeCardBrand ?? ''} ****${
        reservation.stripeCardLast4 ?? ''
      })`,
      amount: input.amount,
      currency: reservation.folio.currency,
      type: 'CHARGE',
      idempotencyKey,
    });

    // Guardamos la referencia al PaymentIntent en attributes del entry.
    await this.prisma.withTenant(ctx, (tx) =>
      tx.folioEntry.update({
        where: { id: charge.entryId },
        data: {
          attributes: {
            stripePaymentIntentId: pi.id,
            stripeChargeId: pi.latest_charge as string | null,
            kind: 'no_show_charge',
          } as Prisma.InputJsonValue,
        },
      }),
    );

    this.log.log(`No-show charge OK ${reservationId} ${pi.id} ${input.amount} ${currency}`);
    return {
      status: 'succeeded',
      paymentIntentId: pi.id,
      folioEntryId: charge.entryId,
    };
  }
}
