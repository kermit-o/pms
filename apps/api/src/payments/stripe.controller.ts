import {
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
import { CurrentUser, Roles, Public } from '../auth';
import type { AuthUser } from '../auth';
import { StripeService } from './stripe.service';

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
      return { ok: false, reason: 'no raw body' };
    }
    return this.stripe.handleWebhook(raw, signature);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
