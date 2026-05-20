import { Injectable } from '@nestjs/common';
import { type Counter, type Histogram, type Meter, metrics } from '@opentelemetry/api';

/**
 * Métricas Prometheus del channel manager (Sprint 9 W2).
 *
 *   channel_manager_sync_total{provider, kind, status}
 *   channel_manager_sync_duration_ms_*{provider, kind} (histogram)
 *   channel_manager_inbound_total{provider, source, outcome}
 *   channel_manager_webhook_rejections_total{provider, reason}
 *
 * Cardinalidad: provider (≈ 1-3), kind (4), source (3 OTAs), outcome
 * (2). Sin labels por property — la salud global del canal es más útil
 * para alerting que la salud por hotel; cuando un hotel tenga problema
 * se mira por `ChannelSyncRun` table directamente.
 */
@Injectable()
export class ChannelManagerMetrics {
  private readonly meter: Meter;
  readonly syncTotal: Counter;
  readonly syncDuration: Histogram;
  readonly inboundTotal: Counter;
  readonly webhookRejections: Counter;

  constructor() {
    this.meter = metrics.getMeter('pms-api/channel-manager');
    this.syncTotal = this.meter.createCounter('channel_manager_sync', {
      description: 'Total intentos de sync con channel manager.',
    });
    this.syncDuration = this.meter.createHistogram('channel_manager_sync_duration_ms', {
      description: 'Duración real de cada sync, ms.',
      unit: 'ms',
    });
    this.inboundTotal = this.meter.createCounter('channel_manager_inbound', {
      description: 'Reservas entrantes por webhook OTA. outcome ∈ {created, updated}.',
    });
    this.webhookRejections = this.meter.createCounter('channel_manager_webhook_rejections', {
      description: 'Webhooks rechazados. reason ∈ {bad_signature, no_provider, parse_error, unknown_property}.',
    });
  }
}
