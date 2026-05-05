import { Controller, Get } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Req } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { PrismaService } from '../db';

/**
 * Endpoint demo que demuestra el flujo completo:
 *   JWT → tenantId → withTenant → RLS → solo se ven properties del tenant.
 *
 * No es la forma final del API. La organizacion definitiva (rooms, rates,
 * reservations...) se decide en Sprint 2 (MVP FO).
 */
@Controller('properties')
export class PropertiesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async list(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return this.prisma.withTenant(
      {
        tenantId: user.tenantId,
        actorId: user.sub,
        correlationId: typeof req.id === 'string' ? req.id : String(req.id),
      },
      (tx) =>
        tx.property.findMany({
          where: { deletedAt: null },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            timezone: true,
            currency: true,
            locale: true,
            createdAt: true,
          },
        }),
    );
  }
}
