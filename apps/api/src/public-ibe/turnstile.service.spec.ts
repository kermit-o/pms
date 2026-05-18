import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TurnstileService } from './turnstile.service';
import type { PublicIbeMetrics } from './public-ibe.metrics';

const FETCH_ORIG = globalThis.fetch;

function stubMetrics(): PublicIbeMetrics {
  return {
    rateLimitHits: { add: vi.fn() },
    blocklistHits: { add: vi.fn() },
    turnstileFailures: { add: vi.fn() },
    turnstileVerifications: { add: vi.fn() },
  } as unknown as PublicIbeMetrics;
}

function buildConfig(env: Record<string, string | undefined>) {
  return { get: vi.fn((key: string) => env[key]) };
}

describe('TurnstileService', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as never;
  });
  afterEach(() => {
    globalThis.fetch = FETCH_ORIG;
  });

  it('disabled when no secret is configured', async () => {
    const metrics = stubMetrics();
    const svc = new TurnstileService(buildConfig({}) as never, metrics);
    expect(svc.enabled).toBe(false);
    const out = await svc.verify('tok', '1.1.1.1', 'h');
    expect(out.ok).toBe(true);
    expect(out.reason).toBe('disabled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns missing when enabled but token absent', async () => {
    const metrics = stubMetrics();
    const svc = new TurnstileService(
      buildConfig({ TURNSTILE_SECRET_KEY: 'sk' }) as never,
      metrics,
    );
    expect(svc.enabled).toBe(true);
    const out = await svc.verify(undefined, '1.1.1.1', 'h');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('missing');
    expect(metrics.turnstileFailures.add).toHaveBeenCalledWith(1, { slug: 'h', reason: 'missing' });
  });

  it('returns ok when CF reports success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as never);
    const svc = new TurnstileService(
      buildConfig({ TURNSTILE_SECRET_KEY: 'sk' }) as never,
      stubMetrics(),
    );
    const out = await svc.verify('tok', '1.1.1.1', 'h');
    expect(out.ok).toBe(true);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = (call[1] as RequestInit).body as string;
    expect(body).toContain('secret=sk');
    expect(body).toContain('response=tok');
  });

  it('returns invalid with error codes when CF reports failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    } as never);
    const svc = new TurnstileService(
      buildConfig({ TURNSTILE_SECRET_KEY: 'sk' }) as never,
      stubMetrics(),
    );
    const out = await svc.verify('tok', '1.1.1.1', 'h');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('invalid');
    expect(out.errorCodes).toEqual(['timeout-or-duplicate']);
  });

  it('treats HTTP error as network failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({}),
    } as never);
    const svc = new TurnstileService(
      buildConfig({ TURNSTILE_SECRET_KEY: 'sk' }) as never,
      stubMetrics(),
    );
    const out = await svc.verify('tok', '1.1.1.1', 'h');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('network');
  });
});
