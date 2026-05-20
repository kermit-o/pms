import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Counter, metrics } from '@opentelemetry/api';
import type { FastifyRequest } from 'fastify';
import { EmailSuppressionReason } from '@pms/db';
import { Public } from '../auth';
import type { Env } from '../config/env.schema';
import { EmailSuppressionsService } from './email-suppressions.service';

/**
 * Postmark inbound webhooks (Sprint 11 W1).
 *
 * Endpoint: `POST /public/notifications/postmark`.
 *
 * Sin auth — Postmark verifica la firma HMAC sobre el cuerpo crudo. La
 * firma viaja en el header `x-postmark-signature` (hex sha256). El
 * secret se setea en el dashboard de Postmark al crear el webhook
 * (`POSTMARK_WEBHOOK_SECRET`). Sin secret configurado, el endpoint
 * devuelve `503` — preferimos rechazar a aceptar bounces sin validar.
 *
 * Postmark agrupa varios `RecordType` en el mismo endpoint:
 *  - `Bounce` — devolución. `Type` discrimina (HardBounce, Transient,
 *    AutoResponder, ...). Solo HardBounce añade suppression.
 *  - `SpamComplaint` — usuario marcó como spam.
 *  - `SubscriptionChange` — `SuppressSending = true` cuando el usuario
 *    se da de baja.
 *  - Otros (Delivery, Open, Click...) — solo log + 200 OK.
 *
 * Idempotente: la suppression service hace upsert por email.
 */

interface PostmarkPayload {
  RecordType?: string;
  Email?: string;
  EmailAddress?: string;
  Recipient?: string;
  Type?: string;
  Description?: string;
  Details?: string;
  SuppressSending?: boolean;
  MessageID?: string;
}

@Public()
@Controller('public/notifications/postmark')
export class PostmarkWebhookController {
  private readonly log = new Logger(PostmarkWebhookController.name);
  private readonly secret: string | undefined;
  private readonly recordsTotal: Counter;
  private readonly recordsRejected: Counter;

  constructor(
    config: ConfigService<Env, true>,
    private readonly suppressions: EmailSuppressionsService,
  ) {
    this.secret = config.get('POSTMARK_WEBHOOK_SECRET', { infer: true });
    const meter = metrics.getMeter('pms-api/notifications');
    this.recordsTotal = meter.createCounter('postmark_webhook_records', {
      description: 'Postmark webhook records procesados. record_type ∈ {bounce, complaint, subscription_change, other}.',
    });
    this.recordsRejected = meter.createCounter('postmark_webhook_rejections', {
      description: 'Postmark webhook rejections. reason ∈ {bad_signature, no_secret}.',
    });
    if (!this.secret) {
      this.log.warn(
        'POSTMARK_WEBHOOK_SECRET not set — webhook will reject all requests with 503.',
      );
    }
  }

  @Post()
  async handle(
    @Req() req: FastifyRequest,
    @Headers('x-postmark-signature') signature: string | undefined,
    @Body() body: PostmarkPayload,
  ) {
    if (!this.secret) {
      this.recordsRejected.add(1, { reason: 'no_secret' });
      throw new ServiceUnavailableException('webhook_secret_missing');
    }
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(body ?? {});
    if (!this.verify(rawBody, signature)) {
      this.recordsRejected.add(1, { reason: 'bad_signature' });
      throw new ForbiddenException('bad_signature');
    }

    const recordType = (body.RecordType ?? '').trim();
    const email = (body.Email ?? body.EmailAddress ?? body.Recipient ?? '').trim();
    if (!email) {
      this.recordsTotal.add(1, { record_type: 'other' });
      this.log.warn(`postmark webhook record_type=${recordType} sin email — ignorado`);
      return { ok: true, action: 'ignored', reason: 'no_email' };
    }

    if (recordType === 'Bounce') {
      const isHard = (body.Type ?? '').toLowerCase() === 'hardbounce';
      this.recordsTotal.add(1, { record_type: 'bounce', subtype: body.Type ?? 'unknown' });
      if (!isHard) {
        this.log.log(`postmark bounce soft email=${email} type=${body.Type} — no suppression`);
        return { ok: true, action: 'noop', reason: 'soft_bounce' };
      }
      await this.suppressions.upsert({
        email,
        reason: EmailSuppressionReason.HARD_BOUNCE,
        detail: body.Description ?? body.Details ?? null,
        source: 'postmark',
      });
      return { ok: true, action: 'suppressed', reason: 'hard_bounce' };
    }

    if (recordType === 'SpamComplaint') {
      this.recordsTotal.add(1, { record_type: 'complaint' });
      await this.suppressions.upsert({
        email,
        reason: EmailSuppressionReason.SPAM_COMPLAINT,
        detail: body.Description ?? null,
        source: 'postmark',
      });
      return { ok: true, action: 'suppressed', reason: 'spam_complaint' };
    }

    if (recordType === 'SubscriptionChange') {
      this.recordsTotal.add(1, { record_type: 'subscription_change' });
      if (body.SuppressSending === true) {
        await this.suppressions.upsert({
          email,
          reason: EmailSuppressionReason.UNSUBSCRIBE,
          detail: 'subscription_change',
          source: 'postmark',
        });
        return { ok: true, action: 'suppressed', reason: 'unsubscribe' };
      }
      // SuppressSending=false → reactivación
      const removed = await this.suppressions.remove(email);
      return { ok: true, action: removed ? 'reactivated' : 'noop' };
    }

    this.recordsTotal.add(1, { record_type: 'other' });
    this.log.log(`postmark webhook record_type=${recordType} email=${email} — no action`);
    return { ok: true, action: 'noop', reason: 'record_type_ignored' };
  }

  private verify(rawBody: string, signature: string | undefined): boolean {
    if (!this.secret || !signature) return false;
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
