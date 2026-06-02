import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { TaxCategory } from '@pms/db';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { UpdatePropertyTaxConfigDto } from './dto';
import { PropertyTaxConfigService } from './property-tax-config.service';

const TaxCategoryParam = z.nativeEnum(TaxCategory);

/**
 * RFC-001 §3.2 — endpoints admin para la matriz IVA por property.
 *   GET  /properties/:id/tax-config            → matriz completa.
 *   PUT  /properties/:id/tax-config/:category  → actualiza rate.
 *
 * Roles: solo manager y tenant_admin. front_desk no debería editar
 * tipos de IVA — su flujo es consumirlos al añadir cargos.
 */
@Controller('properties')
export class PropertyTaxConfigController {
  constructor(private readonly service: PropertyTaxConfigService) {}

  @Get(':propertyId/tax-config')
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async getMatrix(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return this.service.getMatrix(user, correlationIdOf(req), propertyId);
  }

  @Put(':propertyId/tax-config/:category')
  @Roles('tenant_admin')
  async updateRate(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('category') categoryRaw: string,
    @Body() body: unknown,
  ) {
    const category = TaxCategoryParam.parse(categoryRaw);
    const input = UpdatePropertyTaxConfigDto.parse(body);
    return this.service.upsertRate(
      user,
      correlationIdOf(req),
      propertyId,
      category,
      input.taxRate,
    );
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
