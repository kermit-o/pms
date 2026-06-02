import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { CityTaxRuleService } from './city-tax-rule.service';
import { UpsertCityTaxRuleDto } from './dto';

/**
 * RFC-001 §3.3 — endpoints admin para la regla de city tax por
 * property. La regla es 1:1 con property (clave única).
 */
@Controller('properties')
export class CityTaxRuleController {
  constructor(private readonly service: CityTaxRuleService) {}

  @Get(':propertyId/city-tax-rule')
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async get(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    const rule = await this.service.getRule(user, correlationIdOf(req), propertyId);
    if (!rule) {
      throw new NotFoundException(`No city tax rule configured for property ${propertyId}`);
    }
    return rule;
  }

  @Put(':propertyId/city-tax-rule')
  @Roles('tenant_admin')
  async upsert(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() body: unknown,
  ) {
    const input = UpsertCityTaxRuleDto.parse(body);
    return this.service.upsertRule(user, correlationIdOf(req), propertyId, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
