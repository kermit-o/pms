import {
  All,
  Controller,
  Headers,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth';
import { ChannelManagerService } from './channel-manager.service';

/**
 * Webhook receiver para reservas OTA via channel manager (Sprint 9 W2).
 *
 * `POST /public/cm/:slug/webhook` — sin auth (lo verifica el HMAC del
 * provider). El body se valida con `verifyWebhookSignature` del provider
 * antes de parsear; en error → 401/403/400.
 *
 * Idempotente: si `externalRef` coincide con una reserva existente, se
 * actualiza en vez de crearse otra.
 */
@Public()
@Controller('public/cm')
export class ChannelManagerWebhookController {
  constructor(private readonly service: ChannelManagerService) {}

  @Post(':slug/webhook')
  async webhook(
    @Param('slug') slug: string,
    @Headers() headers: Record<string, string | undefined>,
    @Req() req: FastifyRequest,
  ) {
    const rawBody =
      typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
    return this.service.processInboundBooking({ slug, rawBody, headers });
  }

  /** Health check del webhook (útil para que el provider valide el endpoint). */
  @All(':slug/webhook/ping')
  ping(@Param('slug') slug: string) {
    return { ok: true, slug, ts: new Date().toISOString() };
  }
}
