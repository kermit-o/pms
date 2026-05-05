import { z } from 'zod';

/**
 * Envelope estandar para todos los eventos del PMS.
 *
 * Diseñado para que la auditoria continua, los agentes de IA y los consumers
 * de integracion (channel managers, contabilidad) tengan SIEMPRE un set
 * minimo de campos: quien, cuando, en que tenant, con que correlation.
 *
 * El payload es opaco aqui (z.unknown()); cada tipo de evento tiene su propio
 * schema en `catalog/` que se aplica antes de publicar.
 */
export const envelopeSchema = z.object({
  /** UUID v4 unico del evento. Sirve para idempotencia en consumers. */
  id: z.string().uuid(),
  /** Tipo de evento. Coincide con la subject NATS sin el prefijo. Ej: 'property.created'. */
  type: z.string().min(1),
  /** Version del payload. Permite evolucionar schemas sin romper consumers viejos. */
  schemaVersion: z.number().int().positive(),
  /** Tenant al que pertenece el evento. Imprescindible — es la unidad de aislamiento. */
  tenantId: z.string().uuid(),
  /** Quien provoco el evento. UUID del User (o null si fue sistema/job). */
  actorId: z.string().nullable(),
  /** Trazabilidad cross-servicio. Viene del header x-correlation-id del HTTP request. */
  correlationId: z.string().nullable(),
  /** Cuando ocurrio el evento, ISO timestamp UTC. */
  occurredAt: z.string().datetime(),
  /** Payload tipado por el catalog. */
  payload: z.unknown(),
});

export type EventEnvelope<T = unknown> = z.infer<typeof envelopeSchema> & { payload: T };

export const SUBJECT_PREFIX = 'pms.events';
export const STREAM_NAME = 'pms-events';

/** Construye la subject NATS para un tipo de evento. */
export function subjectFor(type: string): string {
  return `${SUBJECT_PREFIX}.${type}`;
}
