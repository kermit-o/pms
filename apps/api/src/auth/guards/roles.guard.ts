import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthUser, Role } from '../types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) {
      // Should never happen — JwtAuthGuard runs first and would have thrown 401.
      throw new ForbiddenException('No authenticated user');
    }
    const hasRole = user.roles.some((r) => required.includes(r));
    if (!hasRole) {
      throw new ForbiddenException(
        `Requires one of: ${required.join(', ')}; user has: ${user.roles.join(', ') || '(none)'}`,
      );
    }
    return true;
  }
}
