/**
 * OpenTelemetry initialization for pms-api.
 *
 * IMPORTANTE: este modulo debe ser el PRIMER import de main.ts.
 * Las auto-instrumentations parchean los modulos de Node (http, fastify,
 * prisma, nats, pino) en el momento en que se cargan; si NestJS o Prisma
 * se importan antes que este modulo, el parche no se aplica.
 *
 * Comportamiento:
 *   - Trazas: si OTEL_EXPORTER_OTLP_ENDPOINT esta set se exporta a un
 *     collector compatible OTLP HTTP (Jaeger / Tempo / OTel Collector).
 *     Si no esta set, las trazas se generan en memoria pero no se exportan
 *     a ningun lado — los trace_id / span_id siguen propagandose y los
 *     logs Pino los incluyen automaticamente (instrumentation-pino).
 *   - Metricas: siempre activas. Prometheus exporter en /metrics (puerto
 *     OTEL_METRICS_PORT, default 9464). Scrape config: ver README.
 *   - Logs: la auto-instrumentation de pino anade trace_id y span_id como
 *     propiedades del log record cuando hay span activo — sin tocar nada
 *     en nuestro logger.module.ts.
 *
 * Disable con OTEL_ENABLED=false (util en tests).
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const enabled = process.env.OTEL_ENABLED !== 'false';

if (enabled) {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const metricsPort = Number(process.env.OTEL_METRICS_PORT ?? 9464);

  const traceExporter = otlpEndpoint
    ? new OTLPTraceExporter({
        url: `${otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
      })
    : undefined;

  const metricReader = new PrometheusExporter({
    port: metricsPort,
    endpoint: '/metrics',
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'pms-api',
      [ATTR_SERVICE_VERSION]: '0.0.1',
    }),
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs es muy ruidoso (se llama en cada require). Apagado por defecto.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Suprime warnings de net si los hay.
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = (): void => {
    void sdk.shutdown().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('OTel shutdown failed:', err);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // eslint-disable-next-line no-console
  console.error(
    `[otel] enabled (traces=${otlpEndpoint ?? 'no-export'}, metrics=:${metricsPort}/metrics)`,
  );
}
