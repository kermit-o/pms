import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Roles, Public } from '../auth';
import type { AuthUser } from '../auth';
import { BillingService } from './billing.service';

const PortalDto = z.object({
  returnUrl: z.string().url(),
});

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * Estado actual de la suscripción del tenant. Cualquier rol
   * autenticado puede leer; sólo `tenant_admin` puede actuar.
   */
  @Get('me/subscription')
  @Roles('tenant_admin', 'front_desk', 'night_auditor', 'housekeeping_supervisor')
  async getSubscription(@CurrentUser() user: AuthUser) {
    return this.billing.getSubscription(user);
  }

  /**
   * Crea Customer + Subscription en Stripe con trial. Idempotente.
   */
  @Post('me/subscription/start')
  @Roles('tenant_admin')
  async start(@CurrentUser() user: AuthUser) {
    return this.billing.startSubscription(user);
  }

  /**
   * Devuelve URL del Stripe Customer Portal para gestión (cambio de
   * tarjeta, cancelación, ver facturas).
   */
  @Post('me/subscription/portal')
  @Roles('tenant_admin')
  async portal(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { returnUrl } = PortalDto.parse(body);
    return this.billing.createPortalSession(user, returnUrl);
  }

  /**
   * Webhook de Stripe Billing. Endpoint separado del webhook del
   * huésped (`/payments/stripe/webhook`) — distinto signing secret,
   * distinto destination. Público porque Stripe firma el body.
   */
  @Post('billing/stripe/webhook')
  @Public()
  async webhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('stripe-signature') signature: string | undefined,
    @Body() _body: unknown,
  ) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('raw_body_required');
    return this.billing.handleWebhook(raw, signature);
  }
}
