import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Counter, metrics } from '@opentelemetry/api';
import { NotificationOutboxStatus, Prisma } from '@pms/db';
import type { HandlerResult } from '@pms/eventbus';
import { PrismaService } from '../db';
import type { Env } from '../config/env.schema';
import { EventbusService } from '../eventbus';
import { EmailSuppressionsService } from './email-suppressions.service';
import { NotificationsService } from './notifications.service';
import type { Locale, TemplateName } from './templates';

/**
 * NotificationsConsumer (Sprint 11 W2).
 *
 * Subscribe durable a `email.send_requested`. Por evento:
 *
 *  1. Idempotencia: dedup por `payload.dedupKey` contra `notification_outbox`.
 *     Si ya existe `DELIVERED`/`SUPPRESSED`, ack inmediato (re-entrega
 *     idempotente).
 *  2. Pre-check de suppression list (defence in depth — el service ya lo
 *     hace, pero el outbox refleja `SUPPRESSED` cuando aplica).
 *  3. Llama a `sendEmail`. Marca el outbox según el resultado:
 *     - OK → `DELIVERED` + ack.
 *     - error transitorio → `FAILED`, attempts++, nak (JetStream
 *       reintenta tras ackWait con back-off implícito).
 *     - max_deliver agotado → JetStream termina el mensaje al DLQ
 *       implícito.
 *
 * El consumer no opera con contexto de tenant — el payload Json en el
 * outbox conserva la trazabilidad necesaria para auditoría.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly log = new Logger(NotificationsConsumer.name);
  private readonly events: Counter;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventbusService,
    private readonly notifications: NotificationsService,
    private readonly suppressions: EmailSuppressionsService,
    config: ConfigService<Env, true>,
  ) {
    const meter = metrics.getMeter('pms-api/notifications');
    this.events = meter.createCounter('notification_consumer_events', {
      description: 'Resultado del consumer NATS por template y outcome.',
    });
    // En entornos de test sin NATS, dejamos el consumer desactivado.
    this.enabled = config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.log.log('NotificationsConsumer disabled (test env)');
      return;
    }
    await this.bus.subscribe(
      'email.send_requested',
      {
        durable: 'notifications-email',
        maxDeliver: 5,
        ackWaitMs: 30_000,
        batchSize: 8,
      },
      async (envelope) => this.handle(envelope.payload, envelope.id),
    );
    this.log.log('NotificationsConsumer subscribed to email.send_requested');
  }

  /**
   * Handler público — exportado para tests unitarios (no requiere NATS).
   * Devuelve el `HandlerResult` que el subscriber traducirá a ack/nak/term.
   */
  async handle(
    payload: {
      template: 'reservation_confirmation' | 'reservation_cancelled' | 'front_desk_new_reservation';
      to: string;
      cc?: string[];
      bcc?: string[];
      locale: Locale;
      params: Record<string, unknown>;
      dedupKey?: string;
    },
    envelopeId: string,
  ): Promise<HandlerResult> {
    const dedupKey = payload.dedupKey ?? envelopeId;

    // 1. Dedup contra outbox.
    const existing = await this.prisma.notificationOutbox.findUnique({
      where: { dedupKey },
      select: { status: true, attempts: true, id: true },
    });
    if (
      existing &&
      (existing.status === NotificationOutboxStatus.DELIVERED ||
        existing.status === NotificationOutboxStatus.SUPPRESSED)
    ) {
      // Re-entrega idempotente; ack para que JetStream lo descarte.
      this.events.add(1, { template: payload.template, outcome: 'idempotent_ack' });
      return 'ack';
    }

    // 2. Upsert outbox como PENDING.
    const row = await this.prisma.notificationOutbox.upsert({
      where: { dedupKey },
      create: {
        dedupKey,
        template: payload.template,
        recipient: payload.to,
        locale: payload.locale,
        params: payload.params as Prisma.InputJsonValue,
        status: NotificationOutboxStatus.PENDING,
        attempts: 1,
      },
      update: { attempts: { increment: 1 } },
      select: { id: true, attempts: true },
    });

    // 3. Pre-check suppression (sendEmail también lo hace, pero queremos
    //    reflejarlo en el outbox).
    const suppressed = await this.suppressions.isSuppressed(payload.to);
    if (suppressed.suppressed) {
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: NotificationOutboxStatus.SUPPRESSED,
          lastError: `suppressed:${suppressed.reason ?? 'unknown'}`,
          failedAt: new Date(),
        },
      });
      this.events.add(1, { template: payload.template, outcome: 'suppressed' });
      // Term: no reintentar, no es transitorio.
      return 'term';
    }

    // 4. Envío.
    try {
      const result = await this.notifications.sendEmail({
        template: payload.template as TemplateName,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        locale: payload.locale,
        params: payload.params,
      });
      if (result.ok) {
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: NotificationOutboxStatus.DELIVERED,
            deliveredAt: new Date(),
            messageId: result.messageId,
          },
        });
        this.events.add(1, { template: payload.template, outcome: 'delivered' });
        return 'ack';
      }
      // Provider devolvió `{ ok: false, error }`. Suppressed → term;
      // resto → nak para reintentar.
      const reason = result.error ?? 'unknown';
      const isSuppressed = reason.startsWith('suppressed:');
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: isSuppressed
            ? NotificationOutboxStatus.SUPPRESSED
            : NotificationOutboxStatus.FAILED,
          lastError: reason.slice(0, 500),
          failedAt: new Date(),
        },
      });
      this.events.add(1, {
        template: payload.template,
        outcome: isSuppressed ? 'suppressed' : 'failed',
      });
      return isSuppressed ? 'term' : 'nak';
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: NotificationOutboxStatus.FAILED,
          lastError: message,
          failedAt: new Date(),
        },
      });
      this.events.add(1, { template: payload.template, outcome: 'error' });
      this.log.error(`consumer handler threw: ${message}`);
      return 'nak';
    }
  }
}
