import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Counter, metrics } from '@opentelemetry/api';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { HandlerResult } from '@pms/eventbus';
import type { AuthUser } from '../../auth';
import type { Env } from '../../config/env.schema';
import { EventbusService } from '../../eventbus';
import { SesHospedajesService } from './ses-hospedajes.service';

/**
 * Auto-encola una submission SES.HOSPEDAJES cada vez que un night-audit
 * completa. Cierra el gap del audit profundo:
 *
 *   "🔴 SES.HOSPEDAJES desacoplado — sin automation event, el hotel debe
 *    acordarse de encolar a mano cada noche o incumple Guardia Civil."
 *
 * El consumer es independiente del operador: el actor es un usuario
 * sintético del sistema. Errores tratados:
 *
 *   - `ConflictException` (submission ya SENT para esa fecha) → ack
 *     idempotente (ya está hecho, no es problema).
 *   - `NotFoundException` (property borrada / no existe) → term (no es
 *     transitorio, no reintentamos).
 *   - Cualquier otro error → nak (transitorio, JetStream reintenta tras
 *     ackWait; tras maxDeliver el mensaje pasa al DLQ implícito).
 *
 * Idempotencia adicional vía `SesHospedajesService.queue()` que ya es
 * idempotente sobre `(propertyId, businessDate)`.
 */
@Injectable()
export class SesHospedajesAutoQueueConsumer implements OnModuleInit {
  private readonly log = new Logger(SesHospedajesAutoQueueConsumer.name);
  private readonly outcome: Counter;
  private readonly enabled: boolean;

  constructor(
    private readonly bus: EventbusService,
    private readonly ses: SesHospedajesService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('NODE_ENV', { infer: true }) !== 'test';
    const meter = metrics.getMeter('pms-api/ses-hospedajes');
    this.outcome = meter.createCounter('ses_auto_queue_total', {
      description: 'Resultado del consumer auto-queue tras night_audit.run_completed.',
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.log.log('SesHospedajesAutoQueueConsumer disabled (test env)');
      return;
    }
    await this.bus.subscribe(
      'night_audit.run_completed',
      { durable: 'ses-auto-queue', maxDeliver: 5, ackWaitMs: 30_000, batchSize: 4 },
      async (envelope) =>
        this.handle({
          tenantId: envelope.tenantId,
          actorId: envelope.actorId,
          correlationId: envelope.correlationId ?? envelope.id,
          payload: envelope.payload,
        }),
    );
    this.log.log('SesHospedajesAutoQueueConsumer subscribed to night_audit.run_completed');
  }

  /**
   * Handler público — tests unitarios lo invocan sin NATS. Construye el
   * AuthUser sintético del sistema y delega al service.
   */
  async handle(args: {
    tenantId: string;
    actorId: string | null;
    correlationId: string;
    payload: { propertyId: string; businessDate: string };
  }): Promise<HandlerResult> {
    const { tenantId, correlationId, payload } = args;

    const systemUser: AuthUser = {
      sub: 'system:ses-auto',
      tenantId,
      email: 'system@aubergine.local',
      // tenant_admin alcanza para queue(); no hay endpoint del operador
      // involucrado, sólo lectura/escritura del propio tenant.
      roles: ['tenant_admin'],
    } as unknown as AuthUser;

    try {
      const r = await this.ses.queue(systemUser, correlationId, {
        propertyId: payload.propertyId,
        businessDate: payload.businessDate,
      });
      this.log.log(
        `Auto-queued SES submission tenant=${tenantId} property=${payload.propertyId} ` +
          `date=${payload.businessDate} submissionId=${r.submissionId} guests=${r.guestCount}`,
      );
      this.outcome.add(1, { outcome: 'queued' });
      return 'ack';
    } catch (err) {
      if (err instanceof ConflictException) {
        // Ya SENT — nada que hacer, idempotent ack.
        this.log.log(
          `SES submission already SENT for ${payload.propertyId} ${payload.businessDate} — ack`,
        );
        this.outcome.add(1, { outcome: 'already_sent' });
        return 'ack';
      }
      if (err instanceof NotFoundException) {
        this.log.warn(`Property ${payload.propertyId} not found for SES auto-queue — terminating`);
        this.outcome.add(1, { outcome: 'property_missing' });
        return 'term';
      }
      const msg = (err as Error).message.slice(0, 500);
      this.log.error(
        `SES auto-queue failed for ${payload.propertyId} ${payload.businessDate}: ${msg}`,
      );
      this.outcome.add(1, { outcome: 'error' });
      return 'nak';
    }
  }
}
