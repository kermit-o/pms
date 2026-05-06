import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { CashService } from './cash.service';
import { ReconciliationQuery, UpsertReconciliationDto } from './dto';

const READ_ROLES = ['tenant_admin', 'front_desk', 'night_auditor'] as const;
const WRITE_ROLES = ['tenant_admin', 'night_auditor', 'front_desk'] as const;

@Controller('cash/reconciliations')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get()
  @Roles(...READ_ROLES)
  async get(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ReconciliationQuery.parse(rawQuery);
    return this.cash.getOrEmpty(user, correlationIdOf(req), query.propertyId, query.businessDate);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  async upsert(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = UpsertReconciliationDto.parse(body);
    return this.cash.upsert(user, correlationIdOf(req), input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
