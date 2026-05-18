import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { TurnstileService } from './turnstile.service';

/**
 * TurnstileGuard (Sprint 9 W4).
 *
 * Aplica solo a endpoints decorados con `@RequireTurnstile()`. El token llega
 * en el body como `turnstileToken` (lo añadimos al DTO) o en el header
 * `cf-turnstile-response`. La IP que se pasa al verifyer es la del cliente
 * (cf-connecting-ip > x-forwarded-for > req.ip).
 *
 * Si `TurnstileService` está deshabilitado (sin secret), el guard pasa de
 * largo — mismo modelo que `RateLimitGuard` con cfg opcional.
 */

export const REQUIRE_TURNSTILE_META = 'public-ibe:require-turnstile';
export const RequireTurnstile = () => SetMetadata(REQUIRE_TURNSTILE_META, true);

interface BodyWithToken {
  turnstileToken?: unknown;
}

@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly log = new Logger(TurnstileGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly turnstile: TurnstileService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_TURNSTILE_META,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;
    if (!this.turnstile.enabled) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const slug = String((req.params as { slug?: string } | undefined)?.slug ?? 'unknown');
    const ip = clientIp(req);
    const token = extractToken(req);
    const result = await this.turnstile.verify(token, ip, slug);
    if (!result.ok) {
      this.log.warn(`Turnstile fail slug=${slug} ip=${ip} reason=${result.reason}`);
      throw new ForbiddenException('captcha_failed');
    }
    return true;
  }
}

function extractToken(req: FastifyRequest): string | undefined {
  const header = req.headers['cf-turnstile-response'];
  if (typeof header === 'string' && header) return header;
  const body = req.body as BodyWithToken | undefined;
  if (body && typeof body.turnstileToken === 'string' && body.turnstileToken) {
    return body.turnstileToken;
  }
  return undefined;
}

function clientIp(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.ip ?? 'unknown';
}
