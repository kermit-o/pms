import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

/**
 * Rate limit in-memory por IP + route. Suficiente para Sprint 8 V1 sin
 * añadir `@nestjs/throttler` (nueva dep). Por encima de un piloto real
 * sustituir por throttler oficial + Redis para soportar multi-instancia.
 *
 * Uso: decorar el endpoint con `@RateLimit({ max, windowMs })`. Sin
 * decorador, el guard no aplica. La identidad es `x-forwarded-for` o
 * remoteAddress + path.
 *
 * El backend público IBE es un módulo aislado — solo aplica el guard a
 * sus controllers, no al resto de la API.
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

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const cfg = this.reflector.getAllAndOverride<RateLimitConfig | undefined>(RATE_LIMIT_META, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!cfg) return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = clientIp(req);
    const key = `${req.routerPath ?? req.url}|${ip}`;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + cfg.windowMs });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > cfg.max) {
      this.log.warn(`Rate limit exceeded ${key} (${bucket.count}/${cfg.max})`);
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

function clientIp(req: FastifyRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.ip ?? 'unknown';
}
