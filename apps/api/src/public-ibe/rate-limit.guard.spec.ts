import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard, RATE_LIMIT_META, type RateLimitConfig } from './rate-limit.guard';

function makeCtx(cfg: RateLimitConfig | undefined, ip = '1.2.3.4', path = '/x') {
  const reflector = new Reflector();
  const handler = function dummy() {};
  if (cfg) Reflect.defineMetadata(RATE_LIMIT_META, cfg, handler);
  return {
    reflector,
    handler,
    ctx: {
      getHandler: () => handler,
      getClass: () => Object,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          ip,
          routerPath: path,
          url: path,
        }),
      }),
    } as unknown as Parameters<RateLimitGuard['canActivate']>[0],
  };
}

describe('RateLimitGuard', () => {
  it('passes through when no decorator is present', () => {
    const { reflector, ctx } = makeCtx(undefined);
    const guard = new RateLimitGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows up to max calls in the window', () => {
    const cfg = { max: 3, windowMs: 60_000 };
    const { reflector, ctx } = makeCtx(cfg, '1.1.1.1', '/avail');
    const guard = new RateLimitGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('separates buckets by IP', () => {
    const cfg = { max: 1, windowMs: 60_000 };
    const reflector = new Reflector();
    const handler1 = function h1() {};
    Reflect.defineMetadata(RATE_LIMIT_META, cfg, handler1);
    const guard = new RateLimitGuard(reflector);
    const make = (ip: string) =>
      ({
        getHandler: () => handler1,
        getClass: () => Object,
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, ip, routerPath: '/p', url: '/p' }),
        }),
      }) as never;
    expect(guard.canActivate(make('a'))).toBe(true);
    expect(guard.canActivate(make('b'))).toBe(true);
    expect(() => guard.canActivate(make('a'))).toThrow(HttpException);
  });
});
