import { BadRequestException, Controller, Get, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { TaxReportService } from './tax-report.service';

/**
 * RFC-001 §3.2 — reporte fiscal por property + rango de fechas.
 *
 * Endpoint:
 *   GET /reports/fiscal?propertyId&from&to
 *
 * (El endpoint legacy /reports/tax sigue vivo en ReportsController
 * para no romper la UI Sprint 3 W4 — se deprecará tras migrar la
 * página al nuevo shape.)
 *
 * Roles: tenant_admin + night_auditor (contable / cierre fiscal).
 */
@Controller('reports')
export class TaxReportController {
  constructor(private readonly service: TaxReportService) {}

  @Get('fiscal')
  @Roles('tenant_admin', 'night_auditor')
  async report(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('from and to are required (YYYY-MM-DD)');
    }
    return this.service.byDay(user, correlationIdOf(req), propertyId, from, to);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
