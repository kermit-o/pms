import { Injectable } from '@nestjs/common';
import { type Counter, type Histogram, type Meter, metrics } from '@opentelemetry/api';

/**
 * Metricas Prometheus de housekeeping. Sprint 4 W5.
 *
 * Las series se emiten via la API estandar de OTel; el PrometheusExporter
 * configurado en observability/tracing.ts las publica en :9464/metrics.
 *
 * Convenciones (consistentes con OTel — el sufijo _total / _minutes lo anade
 * el exporter Prometheus):
 *
 *   hsk_tasks_assigned_total{tenant, property, task_type}
 *   hsk_tasks_started_total{tenant, property}
 *   hsk_tasks_completed_total{tenant, property, resulting_room_status}
 *   hsk_tasks_cancelled_total{tenant, property}
 *   hsk_task_duration_minutes_*{tenant, property, task_type}   (histograma)
 *   hsk_lost_found_registered_total{tenant, property, has_photo}
 *   hsk_lost_found_resolved_total{tenant, property, status}
 *   hsk_pairings_minted_total{tenant}
 *   hsk_pairings_redeemed_total{tenant, outcome}
 *
 * Limitar la cardinalidad: el property_id es OK (decenas/hotel), el
 * tenant_id es OK (cliente), pero NO incluimos task_id ni user_id como
 * label — explotaria la cardinalidad en propiedades activas.
 */
@Injectable()
export class HousekeepingMetrics {
  private readonly meter: Meter;
  readonly tasksAssigned: Counter;
  readonly tasksStarted: Counter;
  readonly tasksCompleted: Counter;
  readonly tasksCancelled: Counter;
  readonly taskDuration: Histogram;
  readonly lostFoundRegistered: Counter;
  readonly lostFoundResolved: Counter;
  readonly pairingsMinted: Counter;
  readonly pairingsRedeemed: Counter;

  constructor() {
    this.meter = metrics.getMeter('pms-api/housekeeping');

    this.tasksAssigned = this.meter.createCounter('hsk_tasks_assigned', {
      description: 'Tareas de housekeeping creadas (assigned).',
    });
    this.tasksStarted = this.meter.createCounter('hsk_tasks_started', {
      description: 'Tareas de housekeeping iniciadas (PENDING -> IN_PROGRESS).',
    });
    this.tasksCompleted = this.meter.createCounter('hsk_tasks_completed', {
      description: 'Tareas de housekeeping completadas.',
    });
    this.tasksCancelled = this.meter.createCounter('hsk_tasks_cancelled', {
      description: 'Tareas de housekeeping canceladas.',
    });
    this.taskDuration = this.meter.createHistogram('hsk_task_duration_minutes', {
      description: 'Duracion real de tareas completadas, en minutos.',
      unit: 'min',
    });
    this.lostFoundRegistered = this.meter.createCounter('hsk_lost_found_registered', {
      description: 'Items lost & found registrados.',
    });
    this.lostFoundResolved = this.meter.createCounter('hsk_lost_found_resolved', {
      description: 'Items lost & found resueltos (CLAIMED o DISPOSED).',
    });
    this.pairingsMinted = this.meter.createCounter('hsk_pairings_minted', {
      description: 'Pairing codes emitidos por supervisores.',
    });
    this.pairingsRedeemed = this.meter.createCounter('hsk_pairings_redeemed', {
      description: 'Pairing codes redimidos. outcome ∈ {success, expired, already, not_found}.',
    });
  }
}
