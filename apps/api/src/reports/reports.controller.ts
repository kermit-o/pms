import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import {
  arrivalsDeparturesReportToCsv,
  inHouseReportToCsv,
  managerReportToCsv,
  revenueReportToCsv,
  taxReportToCsv,
} from './csv';
import { DateReportQuery, ManagerReportQuery, RangeReportQuery } from './dto';
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
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ManagerReportQuery.parse(rawQuery);
    const payload = await this.reports.manager(user, correlationIdOf(req), {
      propertyId: query.propertyId,
      businessDate: query.businessDate,
    });
    if (query.format === 'csv') {
      return sendCsv(reply, `manager-${query.businessDate}.csv`, managerReportToCsv(payload));
    }
    return payload;
  }

  @Get('revenue')
  @Roles(...READ_ROLES)
  async revenue(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = RangeReportQuery.parse(rawQuery);
    const payload = await this.reports.revenue(user, correlationIdOf(req), {
      propertyId: query.propertyId,
      from: query.from,
      to: query.to,
    });
    if (query.format === 'csv') {
      return sendCsv(reply, `revenue-${query.from}-${query.to}.csv`, revenueReportToCsv(payload));
    }
    return payload;
  }

  @Get('tax')
  @Roles(...READ_ROLES)
  async tax(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = RangeReportQuery.parse(rawQuery);
    const payload = await this.reports.tax(user, correlationIdOf(req), {
      propertyId: query.propertyId,
      from: query.from,
      to: query.to,
    });
    if (query.format === 'csv') {
      return sendCsv(reply, `tax-${query.from}-${query.to}.csv`, taxReportToCsv(payload));
    }
    return payload;
  }

  @Get('in-house')
  @Roles(...READ_ROLES)
  async inHouse(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = DateReportQuery.parse(rawQuery);
    const payload = await this.reports.inHouse(user, correlationIdOf(req), {
      propertyId: query.propertyId,
      businessDate: query.businessDate,
    });
    if (query.format === 'csv') {
      return sendCsv(reply, `in-house-${query.businessDate}.csv`, inHouseReportToCsv(payload));
    }
    return payload;
  }

  @Get('arrivals-departures')
  @Roles(...READ_ROLES)
  async arrivalsDepartures(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = DateReportQuery.parse(rawQuery);
    const payload = await this.reports.arrivalsDepartures(user, correlationIdOf(req), {
      propertyId: query.propertyId,
      businessDate: query.businessDate,
    });
    if (query.format === 'csv') {
      return sendCsv(
        reply,
        `arrivals-departures-${query.businessDate}.csv`,
        arrivalsDeparturesReportToCsv(payload),
      );
    }
    return payload;
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}

function sendCsv(reply: FastifyReply, filename: string, body: string): string {
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="${filename}"`);
  return body;
}
