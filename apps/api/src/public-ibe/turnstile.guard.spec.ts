import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_TURNSTILE_META,
  RequireTurnstile,
  TurnstileGuard,
} from './turnstile.guard';
import type { TurnstileService } from './turnstile.service';

function makeCtx(handler: object, body: unknown = {}, headers: Record<string, string> = {}) {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        ip: '1.2.3.4',
        body,
        params: { slug: 'hotel' },
      }),
    }),
  } as never;
}

describe('TurnstileGuard', () => {
  it('passes through when decorator absent', async () => {
    const reflector = new Reflector();
    const svc = { enabled: true, verify: vi.fn() } as unknown as TurnstileService;
    const guard = new TurnstileGuard(reflector, svc);
    const ok = await guard.canActivate(makeCtx(function h() {}));
    expect(ok).toBe(true);
    expect(svc.verify).not.toHaveBeenCalled();
  });

  it('passes through when Turnstile is disabled (no secret)', async () => {
    const reflector = new Reflector();
    const handler = function h() {};
    Reflect.defineMetadata(REQUIRE_TURNSTILE_META, true, handler);
    const svc = { enabled: false, verify: vi.fn() } as unknown as TurnstileService;
    const guard = new TurnstileGuard(reflector, svc);
    expect(await guard.canActivate(makeCtx(handler))).toBe(true);
    expect(svc.verify).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when verify fails', async () => {
    const reflector = new Reflector();
    const handler = function h() {};
    Reflect.defineMetadata(REQUIRE_TURNSTILE_META, true, handler);
    const svc = {
      enabled: true,
      verify: vi.fn().mockResolvedValue({ ok: false, reason: 'invalid' }),
    } as unknown as TurnstileService;
    const guard = new TurnstileGuard(reflector, svc);
    await expect(
      guard.canActivate(makeCtx(handler, { turnstileToken: 'bad' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('extracts token from header if body misses it', async () => {
    const reflector = new Reflector();
    const handler = function h() {};
    Reflect.defineMetadata(REQUIRE_TURNSTILE_META, true, handler);
    const svc = {
      enabled: true,
      verify: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TurnstileService;
    const guard = new TurnstileGuard(reflector, svc);
    const ok = await guard.canActivate(
      makeCtx(handler, {}, { 'cf-turnstile-response': 'h-tok' }),
    );
    expect(ok).toBe(true);
    expect(svc.verify).toHaveBeenCalledWith('h-tok', expect.any(String), 'hotel');
  });

  it('decorator factory returns a SetMetadata fn', () => {
    expect(typeof RequireTurnstile()).toBe('function');
  });
});
