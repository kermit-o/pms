import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtValidatorService } from './jwt-validator.service';
import { JwtAuthGuard } from './guards/jwt.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Registra los dos guards globales:
 *  - JwtAuthGuard valida el bearer token (skipea con @Public()).
 *  - RolesGuard hace cumplir @Roles(...) si esta presente en el handler.
 *
 * El orden importa: JwtAuthGuard primero (popula req.user), RolesGuard
 * despues. NestJS los ejecuta en el orden registrado en este array.
 */
@Global()
@Module({
  providers: [
    JwtValidatorService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtValidatorService],
})
export class AuthModule {}
