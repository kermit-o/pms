import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.schema';
import { EventbusService } from '../eventbus';
import { EmailSuppressionsService } from './email-suppressions.service';
import { renderTemplate, type Locale, type RenderedTemplate, type TemplateName } from './templates';

export interface SendEmailInput {
  template: TemplateName;
  to: string;
  cc?: string[];
  bcc?: string[];
  locale?: Locale;
  params: Record<string, unknown>;
}

export interface EnqueueEmailInput extends SendEmailInput {
  /**
   * Sprint 11 W2 — clave de dedup. Si dos productores publican el mismo
   * dedupKey, el consumer solo entrega una vez. Por defecto se genera un
   * UUID v4 (envío único). Productores como `resendConfirmation` pueden
   * usar `resend-<reservationId>-<timestamp>` para idempotencia explícita.
   */
  dedupKey?: string;
  /** Contexto de tenant para la publicación del evento NATS. */
  tenantId: string;
  actorId?: string | null;
  correlationId?: string | null;
}

export interface EnqueueResult {
  enqueued: boolean;
  dedupKey: string;
  /** Si NATS no estaba listo, hicimos fallback a sendEmail inline. */
  inlineFallback?: boolean;
  /** Resultado del fallback inline si lo hubo. */
  result?: { ok: true; messageId: string } | { ok: false; error: string };
}

export interface EmailProvider {
  send(
    from: string,
    input: SendEmailInput,
    rendered: RenderedTemplate,
  ): Promise<{ ok: true; messageId: string } | { ok: false; error: string }>;
}

/**
 * NotificationsService (Sprint 9 W1).
 *
 * Resuelve plantilla + locale + interpolación de params y delega el
 * envío al provider configurado:
 *
 *  - `PostmarkProvider`: POST REST a https://api.postmarkapp.com/email
 *    (sin SDK npm; reduce superficie de deps).
 *  - `DryRunProvider`: loguea estructurado, no toca la red. Útil en
 *    dev/test o cuando `POSTMARK_SERVER_TOKEN` falta.
 *
 * El consumer NATS (NotificationsConsumer) llama a `sendEmail` cuando
 * recibe un evento email-relacionado. La idempotencia se basa en el
 * `eventId` del envelope NATS — el provider Postmark no garantiza
 * de-dup, así que el consumer mantiene un set in-memory short-lived
 * para evitar reenvíos al reproducir desde un cursor.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  private readonly provider: EmailProvider;
  private readonly from: string;
  readonly mode: 'live' | 'dry_run';

  constructor(
    config: ConfigService<Env, true>,
    @Optional() private readonly suppressions?: EmailSuppressionsService,
    @Optional() private readonly events?: EventbusService,
  ) {
    const token = config.get('POSTMARK_SERVER_TOKEN', { infer: true });
    const from = config.get('NOTIFICATIONS_FROM', { infer: true });
    if (token && from) {
      this.provider = new PostmarkProvider(token);
      this.from = from;
      this.mode = 'live';
      this.log.log(`Notifications init: live (Postmark, from=${from})`);
    } else {
      this.provider = new DryRunProvider(this.log);
      this.from = from ?? 'no-reply@aubergine.local';
      this.mode = 'dry_run';
      this.log.warn('Notifications init: dry_run (POSTMARK_SERVER_TOKEN o NOTIFICATIONS_FROM ausentes)');
    }
  }

  async sendEmail(
    input: SendEmailInput,
  ): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
    // Sprint 11 W1: pre-check de suppression list. Si la suppression
    // service no está inyectada (tests legacy o módulos antiguos), saltar
    // — el comportamiento V1 sigue intacto.
    if (this.suppressions) {
      const status = await this.suppressions.isSuppressed(input.to);
      if (status.suppressed) {
        this.log.log(
          `email[skipped] template=${input.template} to=${input.to} reason=suppressed (${status.reason})`,
        );
        return { ok: false, error: `suppressed:${status.reason}` };
      }
    }
    const locale = input.locale ?? 'es';
    const rendered = renderTemplate(input.template, locale, input.params);
    return this.provider.send(this.from, input, rendered);
  }

  /**
   * Sprint 11 W2 — encola el envío como evento NATS `email.send_requested`.
   * El `NotificationsConsumer` lo procesa de forma desacoplada (retry
   * exponencial vía JetStream nak, dedup por `dedupKey` en
   * `notification_outbox`).
   *
   * Si NATS no está disponible (boot fallido, dev sin docker), hace
   * fallback a `sendEmail` inline para preservar el comportamiento V1.
   * El productor recibe el resultado en `result` con `inlineFallback: true`.
   */
  async enqueueEmail(input: EnqueueEmailInput): Promise<EnqueueResult> {
    const dedupKey = input.dedupKey ?? randomUUID();
    if (!this.events || !this.events.isHealthy()) {
      // Fallback inline cuando NATS no está disponible.
      this.log.warn(
        `enqueueEmail fallback to inline (NATS unavailable) template=${input.template} to=${input.to}`,
      );
      const result = await this.sendEmail(input);
      return { enqueued: false, dedupKey, inlineFallback: true, result };
    }
    try {
      await this.events.publish(
        'email.send_requested',
        {
          tenantId: input.tenantId,
          actorId: input.actorId ?? null,
          correlationId: input.correlationId ?? null,
        },
        {
          template: input.template as 'reservation_confirmation' | 'reservation_cancelled' | 'front_desk_new_reservation',
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          locale: input.locale ?? 'es',
          params: input.params,
          dedupKey,
        },
      );
      return { enqueued: true, dedupKey };
    } catch (err) {
      this.log.warn(
        `enqueueEmail publish failed, falling back to inline: ${(err as Error).message}`,
      );
      const result = await this.sendEmail(input);
      return { enqueued: false, dedupKey, inlineFallback: true, result };
    }
  }
}

/**
 * Provider: dry-run. Loguea estructurado y devuelve éxito artificial.
 */
class DryRunProvider implements EmailProvider {
  constructor(private readonly log: Logger) {}
  async send(
    from: string,
    input: SendEmailInput,
    rendered: RenderedTemplate,
  ): Promise<{ ok: true; messageId: string }> {
    this.log.log(
      `email[dry_run] template=${input.template} from=${from} to=${input.to} locale=${input.locale ?? 'es'} subject="${rendered.subject}"`,
    );
    return { ok: true, messageId: `dryrun-${Date.now()}` };
  }
}

/**
 * Provider: Postmark via REST. No requiere SDK.
 * Endpoint: https://api.postmarkapp.com/email
 *           https://postmarkapp.com/developer/api/email-api
 */
class PostmarkProvider implements EmailProvider {
  private readonly log = new Logger('PostmarkProvider');
  constructor(private readonly serverToken: string) {}

  async send(
    from: string,
    input: SendEmailInput,
    rendered: RenderedTemplate,
  ): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
    const body: Record<string, unknown> = {
      From: from,
      To: input.to,
      Subject: rendered.subject,
      HtmlBody: rendered.html,
      TextBody: rendered.text,
      MessageStream: 'outbound',
    };
    if (input.cc?.length) body.Cc = input.cc.join(',');
    if (input.bcc?.length) body.Bcc = input.bcc.join(',');

    try {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'X-Postmark-Server-Token': this.serverToken,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        MessageID?: string;
        ErrorCode?: number;
        Message?: string;
      };
      if (!res.ok) {
        const error = json.Message ?? `HTTP ${res.status}`;
        this.log.warn(
          `Postmark send failed to=${input.to} template=${input.template} status=${res.status} error=${error}`,
        );
        return { ok: false, error };
      }
      this.log.log(
        `Postmark send ok to=${input.to} template=${input.template} messageId=${json.MessageID}`,
      );
      return { ok: true, messageId: json.MessageID ?? '?' };
    } catch (err) {
      const msg = (err as Error).message;
      this.log.error(`Postmark send threw to=${input.to}: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
