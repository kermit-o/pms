import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';

@Controller('me')
export class MeController {
  /**
   * Devuelve el AuthUser construido a partir del JWT validado.
   * Cualquier usuario autenticado puede llamar (no @Roles).
   */
  @Get()
  me(@CurrentUser() user: AuthUser) {
    return {
      sub: user.sub,
      email: user.email,
      tenantId: user.tenantId,
      roles: user.roles,
    };
  }
}
