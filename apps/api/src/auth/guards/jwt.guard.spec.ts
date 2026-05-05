import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt.guard';
import type { JwtValidatorService } from '../jwt-validator.service';

function makeContext(headers: Record<string, string>, isPublic = false): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string>; user?: unknown };
} {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
  void reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtAuthGuard', () => {
  it('allows public routes without token', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const jwt = { verify: vi.fn() } as unknown as JwtValidatorService;
    const guard = new JwtAuthGuard(reflector, jwt);

    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('rejects when authorization header is missing', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const jwt = { verify: vi.fn() } as unknown as JwtValidatorService;
    const guard = new JwtAuthGuard(reflector, jwt);

    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed bearer header', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const jwt = { verify: vi.fn() } as unknown as JwtValidatorService;
    const guard = new JwtAuthGuard(reflector, jwt);

    const { ctx } = makeContext({ authorization: 'Basic xyz' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches AuthUser to request on valid token', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const authUser = {
      sub: 'user-1',
      email: 'a@b.com',
      tenantId: 't1',
      roles: ['front_desk' as const],
    };
    const jwt = { verify: vi.fn().mockResolvedValue(authUser) } as unknown as JwtValidatorService;
    const guard = new JwtAuthGuard(reflector, jwt);

    const { ctx, req } = makeContext({ authorization: 'Bearer some.jwt.token' });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.user).toEqual(authUser);
    expect(jwt.verify).toHaveBeenCalledWith('some.jwt.token');
  });
});
