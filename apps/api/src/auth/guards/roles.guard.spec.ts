import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard';
import type { AuthUser, Role } from '../types';

describe('RolesGuard', () => {
  const user: AuthUser = {
    sub: 'u1',
    email: 'u1@demo.local',
    tenantId: 't1',
    roles: ['front_desk'],
  };

  it('allows when no @Roles() metadata is set', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new RolesGuard(reflector);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when user has at least one of the required roles', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      'tenant_admin',
      'front_desk',
    ] satisfies Role[]);
    const guard = new RolesGuard(reflector);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws Forbidden when user lacks all required roles', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['night_auditor'] satisfies Role[]);
    const guard = new RolesGuard(reflector);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws Forbidden when no user on request', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['front_desk'] satisfies Role[]);
    const guard = new RolesGuard(reflector);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
