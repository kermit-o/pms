import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';
import { generateArrivalsDeparturesReport } from './generators/arrivals-departures-report';
import { generateInHouseReport } from './generators/in-house-report';
import { generateManagerReport } from './generators/manager-report';
import { generateRevenueReport } from './generators/revenue-report';
import { generateTaxReport } from './generators/tax-report';
import type {
  ArrivalsDeparturesReportPayload,
  InHouseReportPayload,
  ManagerReportPayload,
  RevenueReportPayload,
  TaxReportPayload,
} from './types';

/**
 * Reports service. Delegates to pure generator functions in `generators/`,
 * each wrapped in a tenant-scoped transaction so RLS applies.
 *
 * The same generators are reused by the night-audit SNAPSHOT_REPORTS step
 * so on-demand reads and snapshots stay numerically identical.
 */
@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  manager(
    user: AuthUser,
    correlationId: string,
    args: { propertyId: string; businessDate: string },
  ): Promise<ManagerReportPayload> {
    return this.prisma.withTenant(tenantCtx(user, correlationId), (tx) =>
      generateManagerReport({ tx, tenantId: user.tenantId }, args),
    );
  }

  revenue(
    user: AuthUser,
    correlationId: string,
    args: { propertyId: string; from: string; to: string },
  ): Promise<RevenueReportPayload> {
    if (args.from > args.to) {
      throw new BadRequestException('from must be <= to');
    }
    return this.prisma.withTenant(tenantCtx(user, correlationId), (tx) =>
      generateRevenueReport(
        { tx, tenantId: user.tenantId },
        { propertyId: args.propertyId, range: { from: args.from, to: args.to } },
      ),
    );
  }

  tax(
    user: AuthUser,
    correlationId: string,
    args: { propertyId: string; from: string; to: string },
  ): Promise<TaxReportPayload> {
    if (args.from > args.to) {
      throw new BadRequestException('from must be <= to');
    }
    return this.prisma.withTenant(tenantCtx(user, correlationId), (tx) =>
      generateTaxReport(
        { tx, tenantId: user.tenantId },
        { propertyId: args.propertyId, range: { from: args.from, to: args.to } },
      ),
    );
  }

  inHouse(
    user: AuthUser,
    correlationId: string,
    args: { propertyId: string; businessDate: string },
  ): Promise<InHouseReportPayload> {
    return this.prisma.withTenant(tenantCtx(user, correlationId), (tx) =>
      generateInHouseReport({ tx, tenantId: user.tenantId }, args),
    );
  }

  arrivalsDepartures(
    user: AuthUser,
    correlationId: string,
    args: { propertyId: string; businessDate: string },
  ): Promise<ArrivalsDeparturesReportPayload> {
    return this.prisma.withTenant(tenantCtx(user, correlationId), (tx) =>
      generateArrivalsDeparturesReport({ tx, tenantId: user.tenantId }, args),
    );
  }
}

function tenantCtx(user: AuthUser, correlationId: string) {
  return { tenantId: user.tenantId, actorId: user.sub, correlationId };
}
