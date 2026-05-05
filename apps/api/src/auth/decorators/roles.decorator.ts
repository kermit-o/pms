import { SetMetadata } from '@nestjs/common';
import type { Role } from '../types';

export const ROLES_KEY = 'auth:roles';

/**
 * Restringe el acceso a un handler/controller a los roles indicados.
 * El RolesGuard pasa si el usuario tiene AL MENOS UNO de los roles.
 *
 *   @Roles('tenant_admin', 'front_desk')
 *   @Get('/reservations')
 *   list() { ... }
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
