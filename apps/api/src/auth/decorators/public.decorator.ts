import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marca un controller o handler como publico (sin autenticacion).
 * Lo usa JwtAuthGuard para skipear la validacion del token.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
