import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createNatsConnection,
  ensureStream,
  EventPublisher,
  type CatalogKey,
  type PayloadOf,
  type PublishContext,
  type PublishResult,
} from '@pms/eventbus';
import type { NatsConnection } from 'nats';
import type { Env } from '../config/env.schema';

@Injectable()
export class EventbusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventbusService.name);
  private nc!: NatsConnection;
  private publisher!: EventPublisher;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get('NATS_URL', { infer: true });
    this.nc = await createNatsConnection(url);
    const jsm = await this.nc.jetstreamManager();
    await ensureStream(jsm);
    this.publisher = new EventPublisher(this.nc.jetstream());
    this.logger.log(`NATS connected (${url}) and stream ensured`);
  }

  async onModuleDestroy(): Promise<void> {
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

  /** Liveness check para /readyz. */
  ping(): void {
    if (!this.nc || this.nc.isClosed()) {
      throw new Error('NATS connection closed');
    }
  }
}
