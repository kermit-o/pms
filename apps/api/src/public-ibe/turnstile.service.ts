import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PublicIbeMetrics } from './public-ibe.metrics';

/**
 * Cloudflare Turnstile (Sprint 9 W4 — anti-abuso).
 *
 * Endpoint oficial: https://challenges.cloudflare.com/turnstile/v0/siteverify
 *
 * Sin dependencia npm — `fetch` nativo. Si `TURNSTILE_SECRET_KEY` no está
 * configurada, `verify` devuelve `{ ok: true, mode: 'disabled' }` y los
 * endpoints siguen funcionando. Esto cubre dev local y hoteles sin abuso.
 *
 * Tokens en modo dev: '1x0000000000000000000000000000000AA' (always passes
 * según docs CF). Útil en e2e.
 */
export interface TurnstileVerification {
  ok: boolean;
  reason?: 'missing' | 'invalid' | 'network' | 'disabled';
  errorCodes?: string[];
}

@Injectable()
export class TurnstileService {
  private readonly log = new Logger(TurnstileService.name);
  private readonly secret: string | undefined;
  private readonly endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  constructor(
    config: ConfigService<Env>,
    private readonly metrics: PublicIbeMetrics,
  ) {
    this.secret = config.get('TURNSTILE_SECRET_KEY');
    if (!this.secret) {
      this.log.log('Turnstile disabled (no TURNSTILE_SECRET_KEY)');
    }
  }

  get enabled(): boolean {
    return Boolean(this.secret);
  }

  async verify(token: string | undefined, ip: string, slug: string): Promise<TurnstileVerification> {
    if (!this.secret) {
      this.metrics.turnstileVerifications.add(1, { slug, outcome: 'success' });
      return { ok: true, reason: 'disabled' };
    }
    if (!token) {
      this.metrics.turnstileFailures.add(1, { slug, reason: 'missing' });
      this.metrics.turnstileVerifications.add(1, { slug, outcome: 'failure' });
      return { ok: false, reason: 'missing' };
    }
    try {
      const body = new URLSearchParams({
        secret: this.secret,
        response: token,
        remoteip: ip,
      });
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        this.log.warn(`Turnstile HTTP ${res.status}`);
        this.metrics.turnstileFailures.add(1, { slug, reason: 'network' });
        this.metrics.turnstileVerifications.add(1, { slug, outcome: 'failure' });
        return { ok: false, reason: 'network' };
      }
      const json = (await res.json()) as {
        success: boolean;
        'error-codes'?: string[];
      };
      if (json.success) {
        this.metrics.turnstileVerifications.add(1, { slug, outcome: 'success' });
        return { ok: true };
      }
      this.metrics.turnstileFailures.add(1, { slug, reason: 'invalid' });
      this.metrics.turnstileVerifications.add(1, { slug, outcome: 'failure' });
      return { ok: false, reason: 'invalid', errorCodes: json['error-codes'] };
    } catch (err) {
      this.log.warn(`Turnstile network error: ${(err as Error).message}`);
      this.metrics.turnstileFailures.add(1, { slug, reason: 'network' });
      this.metrics.turnstileVerifications.add(1, { slug, outcome: 'failure' });
      return { ok: false, reason: 'network' };
    }
  }
}
