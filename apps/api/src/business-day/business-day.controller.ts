import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { CloseDayDto, ListDaysQuery, ReopenDayDto } from './dto';
import { BusinessDayService } from './business-day.service';

@Controller('business-day')
export class BusinessDayController {
  constructor(private readonly service: BusinessDayService) {}

  @Get()
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListDaysQuery.parse(rawQuery);
    return this.service.list(user, correlationIdOf(req), query);
  }

  @Get('state')
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async state(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query('propertyId') propertyId: string,
    @Query('businessDate') businessDate: string,
  ) {
    return this.service.getState(user, correlationIdOf(req), propertyId, businessDate);
  }

  @Post('close')
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async close(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = CloseDayDto.parse(body);
    return this.service.close(user, correlationIdOf(req), input);
  }

  @Post('reopen')
  @Roles('tenant_admin')
  async reopen(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = ReopenDayDto.parse(body);
    return this.service.reopen(user, correlationIdOf(req), input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
