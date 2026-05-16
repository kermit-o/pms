import { Injectable } from '@nestjs/common';
import { type Counter, type Meter, metrics } from '@opentelemetry/api';

/**
 * Counters de anomaly detection. Sprint 6 W2.
 *
 *   night_audit_anomalies_total{tenant, property, kind, severity}
 *
 * Cardinalidad: tenant × property × kind(5) × severity(4) = manejable
 * (decenas de propiedades por tenant). El alert NightAuditAnomalyDetected
 * dispara cuando rate > 0 en cualquier severity HIGH|CRITICAL.
 */
@Injectable()
export class AnomalyMetrics {
  private readonly meter: Meter;
  readonly anomalies: Counter;

  constructor() {
    this.meter = metrics.getMeter('pms-api/night-audit-anomaly');
    this.anomalies = this.meter.createCounter('night_audit_anomalies', {
      description: 'Anomalias detectadas durante NA por kind + severity.',
    });
  }
}
