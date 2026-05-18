import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../db';
import { PublicIbeMetrics } from './public-ibe.metrics';

/**
 * Rate limit in-memory por (route + slug + ip) para el IBE público.
 *
 * Sprint 8 V1 dejó la base con `route + ip`. Sprint 9 W4 añade:
 * - clave por slug → un IP que ataca al hotel A no quema cuota del hotel B,
 * - chequeo previo de `Property.attributes.blockedIps` para bloqueo manual,
 * - métricas Prometheus de hits + blocklist.
 *
 * Sigue siendo single-instance. Para multi-replica → Redis sorted-set.
 *
 * Uso: `@RateLimit({ max, windowMs })`. Sin decorador no aplica. La IP es
 * `cf-connecting-ip` > `x-forwarded-for` > `req.ip`.
 */

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export const RATE_LIMIT_META = 'public-ibe:rate-limit';
export const RateLimit = (cfg: RateLimitConfig) => SetMetadata(RATE_LIMIT_META, cfg);

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly log = new Logger(RateLimitGuard.name);
  private readonly buckets = new Map<string, Bucket>();
  private readonly blocklistCache = new Map<string, { ips: Set<string>; expiresAt: number }>();
  private static readonly BLOCKLIST_TTL_MS = 30_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly metrics: PublicIbeMetrics,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const cfg = this.reflector.getAllAndOverride<RateLimitConfig | undefined>(RATE_LIMIT_META, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!cfg) return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const route = req.routerPath ?? req.url ?? '';
    const slug = String((req.params as { slug?: string } | undefined)?.slug ?? '');
    const ip = clientIp(req);

    if (slug && (await this.isBlocked(slug, ip))) {
      this.log.warn(`Blocklist hit slug=${slug} ip=${ip}`);
      this.metrics.blocklistHits.add(1, { slug });
      throw new ForbiddenException('blocked');
    }

    const key = `${route}|${slug}|${ip}`;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + cfg.windowMs });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > cfg.max) {
      this.log.warn(`Rate limit slug=${slug} ip=${ip} route=${route} (${bucket.count}/${cfg.max})`);
      this.metrics.rateLimitHits.add(1, { slug: slug || 'unknown', route });
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private async isBlocked(slug: string, ip: string): Promise<boolean> {
    const cached = this.blocklistCache.get(slug);
    const now = Date.now();
    let ips: Set<string>;
    if (cached && cached.expiresAt > now) {
      ips = cached.ips;
    } else {
      ips = await this.loadBlocklist(slug);
      this.blocklistCache.set(slug, {
        ips,
        expiresAt: now + RateLimitGuard.BLOCKLIST_TTL_MS,
      });
    }
    return ips.has(ip);
  }

  private async loadBlocklist(slug: string): Promise<Set<string>> {
    try {
      const property = await this.prisma.property.findFirst({
        where: { publicSlug: slug, deletedAt: null },
        select: { attributes: true },
      });
      const attrs = property?.attributes as { blockedIps?: unknown } | null | undefined;
      if (!attrs || !Array.isArray(attrs.blockedIps)) return new Set();
      const ips = attrs.blockedIps.filter((x): x is string => typeof x === 'string' && x.length > 0);
      return new Set(ips);
    } catch (err) {
      this.log.warn(`loadBlocklist slug=${slug} error: ${(err as Error).message}`);
      return new Set();
    }
  }
}

function clientIp(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.ip ?? 'unknown';
}
