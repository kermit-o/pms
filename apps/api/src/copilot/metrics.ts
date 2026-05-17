import { Injectable } from '@nestjs/common';
import { type Counter, type Histogram, type Meter, metrics } from '@opentelemetry/api';

/**
 * Metricas Prometheus del copilot. Sprint 6 W1.
 *
 * Series expuestas (via OTel -> Prometheus exporter en :9464/metrics):
 *
 *   copilot_messages_total{tenant, role, model}
 *   copilot_tokens_total{tenant, model, kind=input|output|cache_read|cache_write}
 *   copilot_latency_seconds_*{tenant, model}        (histograma)
 *
 * Cardinalidad: tenant × role × model = ~10×4×3 = 120 series + tokens
 * × kind = 4 mas. Es asumible para Grafana.
 *
 * No incluimos session_id ni user_id como label — explotaria la
 * cardinalidad y no aporta para alerting (la auditoria fina vive en
 * copilot_messages en DB).
 */
@Injectable()
export class CopilotMetrics {
  private readonly meter: Meter;
  readonly messages: Counter;
  readonly tokens: Counter;
  readonly latency: Histogram;

  constructor() {
    this.meter = metrics.getMeter('pms-api/copilot');

    this.messages = this.meter.createCounter('copilot_messages', {
      description: 'Mensajes del copilot por rol (USER, ASSISTANT, TOOL_USE, TOOL_RESULT).',
    });
    this.tokens = this.meter.createCounter('copilot_tokens', {
      description: 'Tokens consumidos por kind ∈ {input, output, cache_read, cache_write}.',
    });
    this.latency = this.meter.createHistogram('copilot_latency_seconds', {
      description: 'Latencia del adapter LLM por turno externo (segundos).',
      unit: 's',
    });
  }
}
