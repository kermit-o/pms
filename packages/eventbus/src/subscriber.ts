import { AckPolicy, JSONCodec } from 'nats';
import type {
  ConsumerConfig,
  ConsumerInfo,
  JetStreamClient,
  JetStreamManager,
  JsMsg,
} from 'nats';
import { envelopeSchema, STREAM_NAME, subjectFor, type EventEnvelope } from './envelope';
import type { CatalogKey, PayloadOf } from './catalog';
import { catalog } from './catalog';

const codec = JSONCodec();

export interface SubscribeOptions {
  /** Nombre durable del consumer JetStream. Estable entre reinicios. */
  durable: string;
  /** Máximo de re-entregas antes de TERMINAR el mensaje (DLQ implícito). */
  maxDeliver?: number;
  /** Cuánto esperar entre redeliveries (ms). Default 30s. */
  ackWaitMs?: number;
  /** Cuántos mensajes en flight a la vez. Default 8. */
  batchSize?: number;
}

/**
 * Resultado del handler:
 *  - `ack`: mensaje procesado OK, no redeliver.
 *  - `nak`: error transitorio, redeliver tras ackWait.
 *  - `term`: error permanente, no redeliver (la suppression list ya
 *    descartó la email, por ejemplo). Acaba en el DLQ implícito.
 */
export type HandlerResult = 'ack' | 'nak' | 'term';

export type EnvelopeHandler<K extends CatalogKey> = (
  envelope: EventEnvelope<PayloadOf<K>>,
  msg: JsMsg,
) => Promise<HandlerResult>;

/**
 * Wrapper minimalista sobre JetStream pull-consumer.
 *
 * - Crea / actualiza un durable consumer con AckExplicit.
 * - Loop: pull `batchSize` mensajes, decodifica el envelope, valida con
 *   el schema del catálogo y delega al handler.
 * - El handler decide ack/nak/term — el subscriber traduce a la API de
 *   JetStream.
 *
 * No depende de NestJS: el módulo de la API instancia este Subscriber
 * dentro de un `@Injectable()` con `OnModuleInit/Destroy`.
 */
export class Subscriber {
  private stop = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly jsm: JetStreamManager,
    private readonly js: JetStreamClient,
  ) {}

  async subscribe<K extends CatalogKey>(
    type: K,
    opts: SubscribeOptions,
    handler: EnvelopeHandler<K>,
  ): Promise<void> {
    if (!(type in catalog)) throw new Error(`Unknown event type: ${String(type)}`);

    const filterSubject = subjectFor(type as string);
    const config: Partial<ConsumerConfig> = {
      durable_name: opts.durable,
      ack_policy: AckPolicy.Explicit,
      max_deliver: opts.maxDeliver ?? 5,
      ack_wait: (opts.ackWaitMs ?? 30_000) * 1_000_000,
      filter_subject: filterSubject,
    };
    await upsertConsumer(this.jsm, opts.durable, config);

    const batchSize = opts.batchSize ?? 8;
    const consumer = await this.js.consumers.get(STREAM_NAME, opts.durable);
    const def = catalog[type];

    this.loopPromise = (async () => {
      while (!this.stop) {
        let msgs;
        try {
          msgs = await consumer.fetch({
            max_messages: batchSize,
            expires: 10_000,
          });
        } catch {
          if (this.stop) return;
          await sleep(500);
          continue;
        }
        for await (const msg of msgs) {
          if (this.stop) return;
          let outcome: HandlerResult = 'nak';
          try {
            const raw = codec.decode(msg.data);
            const envelope = envelopeSchema.parse(raw);
            // Validación adicional del payload contra el catálogo del tipo.
            const validated = def.schema.parse(envelope.payload);
            const typed: EventEnvelope<PayloadOf<K>> = {
              ...envelope,
              payload: validated as PayloadOf<K>,
            };
            outcome = await handler(typed, msg);
          } catch (err) {
            // Decoding o handler crashed — error no recuperable.
            // Log + term para que vaya al DLQ implícito.
            outcome = 'term';
            // El subscriber no tiene Logger; el handler debería loguear.
            // Re-emitimos el error en stderr para no perderlo:
            console.error(
              `[Subscriber] handler crashed type=${String(type)} err=${(err as Error).message}`,
            );
          }
          if (outcome === 'ack') {
            msg.ack();
          } else if (outcome === 'term') {
            msg.term();
          } else {
            msg.nak();
          }
        }
      }
    })();
  }

  async drain(): Promise<void> {
    this.stop = true;
    if (this.loopPromise) await this.loopPromise.catch(() => undefined);
  }
}

async function upsertConsumer(
  jsm: JetStreamManager,
  durable: string,
  config: Partial<ConsumerConfig>,
): Promise<ConsumerInfo> {
  try {
    return await jsm.consumers.add(STREAM_NAME, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('already exists') ||
      msg.toLowerCase().includes('already in use') ||
      msg.toLowerCase().includes('consumer name already')
    ) {
      return await jsm.consumers.update(STREAM_NAME, durable, config);
    }
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
