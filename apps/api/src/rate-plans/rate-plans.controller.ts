import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { CreateRatePlanDto, UpdateRatePlanDto } from './dto';
import { RatePlansService } from './rate-plans.service';

@Controller()
export class RatePlansController {
  constructor(private readonly service: RatePlansService) {}

  @Get('properties/:propertyId/rate-plans')
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return this.service.list(user, correlationIdOf(req), propertyId);
  }

  @Post('properties/:propertyId/rate-plans')
  @Roles('tenant_admin')
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() body: unknown,
  ) {
    const input = CreateRatePlanDto.parse(body);
    return this.service.create(user, correlationIdOf(req), propertyId, input);
  }

  @Patch('rate-plans/:id')
  @Roles('tenant_admin')
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateRatePlanDto.parse(body);
    return this.service.update(user, correlationIdOf(req), id, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
