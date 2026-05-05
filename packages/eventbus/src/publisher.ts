import { randomUUID } from 'node:crypto';
import { headers, JSONCodec } from 'nats';
import type { JetStreamClient } from 'nats';
import { catalog, type CatalogKey, type PayloadOf } from './catalog';
import { subjectFor, type EventEnvelope } from './envelope';

const codec = JSONCodec();

export interface PublishContext {
  tenantId: string;
  actorId?: string | null;
  correlationId?: string | null;
}

export interface PublishResult {
  id: string;
  sequence: number;
  type: string;
}

/**
 * Publica eventos validados al stream JetStream.
 *
 * Reglas:
 *  - Se valida el payload con Zod ANTES de publicar (fail-fast).
 *  - El envelope se construye en codigo, no se acepta desde fuera.
 *  - id (UUID v4) sirve como Nats-Msg-Id header para deduplicacion en
 *    el stream (config Stream.duplicate_window por defecto = 2min).
 */
export class EventPublisher {
  constructor(private readonly js: JetStreamClient) {}

  async publish<K extends CatalogKey>(
    type: K,
    ctx: PublishContext,
    payload: PayloadOf<K>,
  ): Promise<PublishResult> {
    const def = catalog[type];
    if (!def) {
      throw new Error(`Unknown event type: ${String(type)}`);
    }
    const validatedPayload = def.schema.parse(payload) as PayloadOf<K>;

    const envelope: EventEnvelope<PayloadOf<K>> = {
      id: randomUUID(),
      type,
      schemaVersion: def.schemaVersion,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId ?? null,
      correlationId: ctx.correlationId ?? null,
      occurredAt: new Date().toISOString(),
      payload: validatedPayload,
    };

    const h = headers();
    h.set('Nats-Msg-Id', envelope.id);

    const ack = await this.js.publish(subjectFor(type), codec.encode(envelope), { headers: h });

    return { id: envelope.id, sequence: Number(ack.seq), type };
  }
}
