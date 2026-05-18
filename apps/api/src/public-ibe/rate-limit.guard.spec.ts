import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard, RATE_LIMIT_META, type RateLimitConfig } from './rate-limit.guard';
import type { PublicIbeMetrics } from './public-ibe.metrics';
import type { PrismaService } from '../db';

function stubMetrics(): PublicIbeMetrics {
  return {
    rateLimitHits: { add: vi.fn() },
    blocklistHits: { add: vi.fn() },
    turnstileFailures: { add: vi.fn() },
    turnstileVerifications: { add: vi.fn() },
  } as unknown as PublicIbeMetrics;
}

function stubPrisma(attrs: Record<string, unknown> | null = null): PrismaService {
  return {
    property: {
      findFirst: vi.fn().mockResolvedValue(attrs ? { attributes: attrs } : null),
    },
  } as unknown as PrismaService;
}

function makeReq(ip: string, path: string, slug?: string, headers: Record<string, string> = {}) {
  return {
    headers,
    ip,
    routerPath: path,
    url: path,
    params: slug !== undefined ? { slug } : undefined,
  };
}

function ctx(handler: object, req: ReturnType<typeof makeReq>) {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

describe('RateLimitGuard', () => {
  it('passes through when no decorator is present', async () => {
    const reflector = new Reflector();
    const handler = function dummy() {};
    const guard = new RateLimitGuard(reflector, stubPrisma(), stubMetrics());
    expect(await guard.canActivate(ctx(handler, makeReq('1.1.1.1', '/x')))).toBe(true);
  });

  it('allows up to max calls in the window', async () => {
    const cfg: RateLimitConfig = { max: 3, windowMs: 60_000 };
    const reflector = new Reflector();
    const handler = function h() {};
    Reflect.defineMetadata(RATE_LIMIT_META, cfg, handler);
    const guard = new RateLimitGuard(reflector, stubPrisma(), stubMetrics());
    const req = makeReq('1.1.1.1', '/avail', 'hotel');
    expect(await guard.canActivate(ctx(handler, req))).toBe(true);
    expect(await guard.canActivate(ctx(handler, req))).toBe(true);
    expect(await guard.canActivate(ctx(handler, req))).toBe(true);
    await expect(guard.canActivate(ctx(handler, req))).rejects.toBeInstanceOf(HttpException);
  });

  it('separates buckets by IP and slug', async () => {
    const cfg: RateLimitConfig = { max: 1, windowMs: 60_000 };
    const reflector = new Reflector();
    const handler = function h() {};
    Reflect.defineMetadata(RATE_LIMIT_META, cfg, handler);
    const guard = new RateLimitGuard(reflector, stubPrisma(), stubMetrics());
    expect(await guard.canActivate(ctx(handler, makeReq('a', '/p', 'h1')))).toBe(true);
    expect(await guard.canActivate(ctx(handler, makeReq('b', '/p', 'h1')))).toBe(true);
    expect(await guard.canActivate(ctx(handler, makeReq('a', '/p', 'h2')))).toBe(true);
    await expect(
      guard.canActivate(ctx(handler, makeReq('a', '/p', 'h1'))),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects with 403 when IP is in property blockedIps', async () => {
    const cfg: RateLimitConfig = { max: 100, windowMs: 60_000 };
    const reflector = new Reflector();
    const handler = function h() {};
    Reflect.defineMetadata(RATE_LIMIT_META, cfg, handler);
    const prisma = stubPrisma({ blockedIps: ['1.2.3.4'] });
    const metrics = stubMetrics();
    const guard = new RateLimitGuard(reflector, prisma, metrics);
    await expect(
      guard.canActivate(ctx(handler, makeReq('1.2.3.4', '/p', 'hotel-evil'))),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(metrics.blocklistHits.add).toHaveBeenCalledWith(1, { slug: 'hotel-evil' });
  });

  it('prefers cf-connecting-ip over x-forwarded-for and req.ip', async () => {
    const cfg: RateLimitConfig = { max: 1, windowMs: 60_000 };
    const reflector = new Reflector();
    const handler = function h() {};
    Reflect.defineMetadata(RATE_LIMIT_META, cfg, handler);
    const prisma = stubPrisma({ blockedIps: ['9.9.9.9'] });
    const guard = new RateLimitGuard(reflector, prisma, stubMetrics());
    const req = makeReq('1.1.1.1', '/p', 'h', {
      'cf-connecting-ip': '9.9.9.9',
      'x-forwarded-for': '8.8.8.8',
    });
    await expect(guard.canActivate(ctx(handler, req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
