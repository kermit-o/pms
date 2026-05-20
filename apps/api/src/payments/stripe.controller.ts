import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Roles, Public } from '../auth';
import type { AuthUser } from '../auth';
import { StripeService } from './stripe.service';

const ChargeNoShowDto = z.object({
  amount: z.number().positive(),
  description: z.string().min(1).max(200).optional(),
});

const FRONT_DESK_ROLES = ['tenant_admin', 'front_desk'] as const;

@Controller('payments/stripe')
export class StripeController {
  constructor(private readonly stripe: StripeService) {}

  /**
   * Crea (o reusa) un SetupIntent para tokenizar la tarjeta del huésped.
   * La web monta Stripe Elements con el client_secret devuelto.
   */
  @Post('reservations/:id/setup-intent')
  @Roles(...FRONT_DESK_ROLES)
  async createSetupIntent(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.stripe.createSetupIntent(user, correlationIdOf(req), id);
  }

  /**
   * Llamado por el frontend tras confirmSetup() para fijar SECURED.
   * Sirve como fallback cuando el webhook no está disponible. Idempotente.
   */
  @Post('reservations/:id/confirm-setup-intent')
  @Roles(...FRONT_DESK_ROLES)
  async confirmSetupIntent(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.stripe.confirmSetupIntent(user, correlationIdOf(req), id);
  }

  /**
   * Fase 2 — cobro off-session de no-show contra la tarjeta tokenizada
   * en Fase 1. Idempotente por reservationId (un cargo no-show por reserva).
   */
  @Post('reservations/:id/charge-no-show')
  @Roles(...FRONT_DESK_ROLES)
  async chargeNoShow(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = ChargeNoShowDto.parse(body);
    return this.stripe.chargeNoShow(user, correlationIdOf(req), id, input);
  }

  /**
   * Webhook de Stripe. Público (Stripe firma con whsec_, validamos firma
   * dentro del service). Requiere raw body.
   */
  @Post('webhook')
  @Public()
  async webhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('stripe-signature') signature: string | undefined,
    @Body() _body: unknown,
  ) {
    const raw = req.rawBody;
    if (!raw) {
      // Sin raw body no podemos verificar la firma — error real, 400.
      throw new BadRequestException('raw_body_required');
    }
    return this.stripe.handleWebhook(raw, signature);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
