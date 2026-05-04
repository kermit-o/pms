# @pms/eventbus

Cliente NATS JetStream tipado y catálogo de eventos del dominio.

## Principio (ADR-003)

**Cada cambio de estado emite un evento.** La IA, los reportes y la auditoría continua consumen estos streams.

## Catálogo previsto

- `reservation.created`
- `reservation.modified`
- `reservation.cancelled`
- `guest.checked-in`
- `guest.checked-out`
- `folio.charge-posted`
- `folio.payment-received`
- `room.status-changed`
- `housekeeping.task-assigned`
- `housekeeping.task-completed`
- `night-audit.day-closed`

Cada evento lleva `tenant_id`, `actor_id`, `correlation_id`, `timestamp`, `payload` tipado con Zod.
