import { Controller, Get, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { ManagerReportQuery, RangeReportQuery } from './dto';
import { ReportsService } from './reports.service';

const READ_ROLES = ['tenant_admin', 'front_desk', 'night_auditor'] as const;

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('manager')
  @Roles(...READ_ROLES)
  async manager(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ManagerReportQuery.parse(rawQuery);
    return this.reports.manager(user, correlationIdOf(req), query);
  }

  @Get('revenue')
  @Roles(...READ_ROLES)
  async revenue(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = RangeReportQuery.parse(rawQuery);
    return this.reports.revenue(user, correlationIdOf(req), query);
  }

  @Get('tax')
  @Roles(...READ_ROLES)
  async tax(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = RangeReportQuery.parse(rawQuery);
    return this.reports.tax(user, correlationIdOf(req), query);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
