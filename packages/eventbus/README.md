# @pms/eventbus

Cliente NATS JetStream tipado para publicar eventos del PMS con validación Zod.

## Concepto

Toda mutación significativa del dominio emite un evento al stream `pms-events`
de NATS JetStream. Esto permite:

- **Auditoría continua** (Night Audit puede consumir eventos en streaming).
- **Agentes de IA** (consumen eventos para reaccionar en tiempo real).
- **Integraciones** (channel managers, contabilidad, etc., suscriben sin
  acoplarse al API).

## Envelope estándar

Todo evento lleva el mismo envelope:

```typescript
{
  id: string,            // UUID v4 (también va como Nats-Msg-Id para dedupe)
  type: string,          // ej: "property.created"
  schemaVersion: number, // 1, 2, ... — evolución sin romper consumers viejos
  tenantId: string,      // unidad de aislamiento
  actorId: string | null,
  correlationId: string | null,
  occurredAt: string,    // ISO 8601 UTC
  payload: T,            // tipado por catalog
}
```

## Catálogo

`src/catalog/` contiene los schemas Zod por tipo. Para añadir un evento:

1. Crea el schema en `src/catalog/<dominio>.ts`.
2. Añádelo al `catalog` central en `src/catalog/index.ts` con su `schemaVersion`.
3. Listo — `EventPublisher.publish('<tipo>', ctx, payload)` ya lo conoce.

## Uso

```typescript
import { createNatsConnection, ensureStream, EventPublisher } from '@pms/eventbus';

const nc = await createNatsConnection(process.env.NATS_URL!);
const jsm = await nc.jetstreamManager();
await ensureStream(jsm);

const publisher = new EventPublisher(nc.jetstream());

const { id, sequence } = await publisher.publish(
  'property.created',
  { tenantId, actorId: userId, correlationId: req.id },
  { propertyId, code: 'BCN01', name: 'Hotel Demo', timezone: 'Europe/Madrid', currency: 'EUR' },
);
```

## Stream config

Un único stream `pms-events` con subject pattern `pms.events.>`. Retention
basada en límites (max_age 30 días). Detalles de la decisión en ADR-016.

## Tests

```bash
pnpm --filter @pms/eventbus test               # unit (mock NATS)
pnpm --filter @pms/eventbus test:integration   # contra NATS real (docker compose)
```
