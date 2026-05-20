import { Injectable } from '@nestjs/common';
import { type Counter, type Meter, metrics } from '@opentelemetry/api';

/**
 * Métricas Prometheus del IBE público (Sprint 9 W4 — anti-abuso).
 *
 * Cardinalidad: el label `slug` es bajo (≈ 1 por hotel, decenas a medio
 * plazo). `route` también acotado (≈ 7 endpoints). No incluimos `ip` —
 * explotaría la cardinalidad bajo abuso real, que es justo cuando estas
 * métricas importan.
 *
 *   public_ibe_rate_limit_hits_total{slug, route}
 *   public_ibe_blocklist_hits_total{slug}
 *   public_ibe_turnstile_failures_total{slug, reason}
 *   public_ibe_turnstile_verifications_total{slug, outcome}
 */
@Injectable()
export class PublicIbeMetrics {
  private readonly meter: Meter;
  readonly rateLimitHits: Counter;
  readonly blocklistHits: Counter;
  readonly turnstileFailures: Counter;
  readonly turnstileVerifications: Counter;

  constructor() {
    this.meter = metrics.getMeter('pms-api/public-ibe');
    this.rateLimitHits = this.meter.createCounter('public_ibe_rate_limit_hits', {
      description: 'Requests rechazadas por rate limit en el IBE público.',
    });
    this.blocklistHits = this.meter.createCounter('public_ibe_blocklist_hits', {
      description: 'Requests rechazadas porque la IP está en blockedIps del hotel.',
    });
    this.turnstileFailures = this.meter.createCounter('public_ibe_turnstile_failures', {
      description: 'Verificaciones Turnstile fallidas. reason ∈ {missing, invalid, network, disabled}.',
    });
    this.turnstileVerifications = this.meter.createCounter('public_ibe_turnstile_verifications', {
      description: 'Verificaciones Turnstile completadas. outcome ∈ {success, failure}.',
    });
  }
}
