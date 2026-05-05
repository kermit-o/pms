import { connect, RetentionPolicy, StorageType } from 'nats';
import type { JetStreamManager, NatsConnection, StreamConfig } from 'nats';
import { STREAM_NAME, SUBJECT_PREFIX } from './envelope';

/**
 * Configuracion del unico stream JetStream del PMS.
 *
 * Decisiones (ver ADR-016):
 *  - 1 stream catch-all para todos los eventos. Subject pattern incluye
 *    todos los tipos via wildcard. Multi-stream se introducira si la carga
 *    o las politicas de retencion divergen entre dominios.
 *  - Retention=Limits con max_age 30 dias. La auditoria continua mas alla
 *    de 30 dias se sirve desde audit_log (Postgres), no desde el stream.
 *  - File storage para sobrevivir restarts.
 */
export function buildStreamConfig(): Partial<StreamConfig> {
  return {
    name: STREAM_NAME,
    subjects: [`${SUBJECT_PREFIX}.>`],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    // 30 dias en nanosegundos (la unidad que usa NATS para max_age)
    max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
  };
}

export async function createNatsConnection(servers: string): Promise<NatsConnection> {
  return connect({ servers, name: 'pms-api', maxReconnectAttempts: -1 });
}

/**
 * Crea o actualiza el stream `pms-events`. Idempotente.
 */
export async function ensureStream(jsm: JetStreamManager): Promise<void> {
  try {
    await jsm.streams.add(buildStreamConfig());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Si el stream ya existe, intenta actualizarlo (puede haber cambiado config).
    if (
      msg.includes('stream name already in use') ||
      msg.includes('stream wq_overlap') ||
      msg.toLowerCase().includes('already')
    ) {
      await jsm.streams.update(STREAM_NAME, buildStreamConfig());
      return;
    }
    throw err;
  }
}
