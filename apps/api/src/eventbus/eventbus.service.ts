import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createNatsConnection,
  ensureStream,
  EventPublisher,
  Subscriber,
  type CatalogKey,
  type EnvelopeHandler,
  type PayloadOf,
  type PublishContext,
  type PublishResult,
  type SubscribeOptions,
} from '@pms/eventbus';
import type { JetStreamClient, JetStreamManager, NatsConnection } from 'nats';
import type { Env } from '../config/env.schema';

@Injectable()
export class EventbusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventbusService.name);
  private nc: NatsConnection | undefined;
  private publisher: EventPublisher | undefined;
  private jsm: JetStreamManager | undefined;
  private js: JetStreamClient | undefined;
  private readonly subscribers: Subscriber[] = [];

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get('NATS_URL', { infer: true });
    this.nc = await createNatsConnection(url);
    this.jsm = await this.nc.jetstreamManager();
    await ensureStream(this.jsm);
    this.js = this.nc.jetstream();
    this.publisher = new EventPublisher(this.js);
    this.logger.log(`NATS connected (${url}) and stream ensured`);
  }

  async onModuleDestroy(): Promise<void> {
    // Drain subscribers first so we stop consuming, then drain the connection.
    for (const sub of this.subscribers) {
      try {
        await sub.drain();
      } catch (err) {
        this.logger.warn({ err }, 'Subscriber drain failed during shutdown');
      }
    }
    if (!this.nc) return;
    try {
      await this.nc.drain();
    } catch (err) {
      this.logger.warn({ err }, 'NATS drain failed during shutdown');
    }
  }

  publish<K extends CatalogKey>(
    type: K,
    ctx: PublishContext,
    payload: PayloadOf<K>,
  ): Promise<PublishResult> {
    if (!this.publisher) {
      throw new Error('EventbusService not initialized yet');
    }
    return this.publisher.publish(type, ctx, payload);
  }

  /**
   * Crea (o reusa) un durable consumer JetStream y arranca el loop de
   * fetch. El handler decide ack/nak/term por mensaje. Sprint 11 W2.
   *
   * El subscriber se drena automáticamente en `onModuleDestroy`.
   */
  async subscribe<K extends CatalogKey>(
    type: K,
    opts: SubscribeOptions,
    handler: EnvelopeHandler<K>,
  ): Promise<void> {
    if (!this.jsm || !this.js) {
      throw new Error('EventbusService not initialized yet');
    }
    const sub = new Subscriber(this.jsm, this.js);
    await sub.subscribe(type, opts, handler);
    this.subscribers.push(sub);
  }

  /** True si la conexión NATS está abierta y el publisher listo. */
  isHealthy(): boolean {
    return Boolean(this.nc && !this.nc.isClosed() && this.publisher);
  }

  /** Liveness check para /readyz. */
  ping(): void {
    if (!this.nc || this.nc.isClosed()) {
      throw new Error('NATS connection closed');
    }
  }
}
