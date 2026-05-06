import { Logger } from '@nestjs/common';
import { NightAuditReportType, NightAuditStep, Prisma } from '@pms/db';
import { generateManagerReport, generateRevenueReport, generateTaxReport } from '../../reports';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('SnapshotReportsStep');

/**
 * Persists immutable snapshots of the 5 night-audit reports for the day.
 *
 * Manager / Revenue / Tax payloads are produced by the same generator
 * functions exposed at GET /reports/*, so a snapshot row matches what the
 * UI shows on the same date. IN_HOUSE and ARRIVALS_DEPARTURES still ship a
 * lightweight payload until W4 wires the detail rows.
 *
 * Idempotency: night_audit_snapshots has UNIQUE (property, date,
 * reportType); we upsert each row in place on a re-run.
 */
export class SnapshotReportsStep implements StepRunner {
  readonly step = NightAuditStep.SNAPSHOT_REPORTS;

  async run(ctx: StepContext): Promise<StepResult> {
    const reportCtx = { tx: ctx.tx, tenantId: ctx.user.tenantId };
    const range = { from: ctx.businessDate, to: ctx.businessDate };

    const [manager, revenue, tax, inHouse, arrivals, departures] = await Promise.all([
      generateManagerReport(reportCtx, {
        propertyId: ctx.propertyId,
        businessDate: ctx.businessDate,
      }),
      generateRevenueReport(reportCtx, { propertyId: ctx.propertyId, range }),
      generateTaxReport(reportCtx, { propertyId: ctx.propertyId, range }),
      ctx.tx.reservation.count({
        where: {
          propertyId: ctx.propertyId,
          deletedAt: null,
          status: 'CHECKED_IN',
          arrivalDate: { lte: ctx.businessDateAsDate },
          departureDate: { gt: ctx.businessDateAsDate },
        },
      }),
      ctx.tx.reservation.count({
        where: {
          propertyId: ctx.propertyId,
          deletedAt: null,
          arrivalDate: ctx.businessDateAsDate,
        },
      }),
      ctx.tx.reservation.count({
        where: {
          propertyId: ctx.propertyId,
          deletedAt: null,
          departureDate: ctx.businessDateAsDate,
        },
      }),
    ]);

    const generatedAt = new Date();
    const payloads: Record<NightAuditReportType, Prisma.InputJsonValue> = {
      MANAGER: manager as unknown as Prisma.InputJsonValue,
      IN_HOUSE: { businessDate: ctx.businessDate, count: inHouse },
      ARRIVALS_DEPARTURES: {
        businessDate: ctx.businessDate,
        arrivals,
        departures,
      },
      REVENUE: revenue as unknown as Prisma.InputJsonValue,
      TAX: tax as unknown as Prisma.InputJsonValue,
    };

    let written = 0;
    for (const reportType of Object.keys(payloads) as NightAuditReportType[]) {
      await ctx.tx.nightAuditSnapshot.upsert({
        where: {
          propertyId_businessDate_reportType: {
            propertyId: ctx.propertyId,
            businessDate: ctx.businessDateAsDate,
            reportType,
          },
        },
        update: {
          payload: payloads[reportType],
          generatedAt,
          runId: ctx.runId,
        },
        create: {
          tenantId: ctx.user.tenantId,
          propertyId: ctx.propertyId,
          businessDate: ctx.businessDateAsDate,
          reportType,
          payload: payloads[reportType],
          generatedAt,
          runId: ctx.runId,
        },
      });
      written += 1;
    }

    log.log(`wrote ${written} snapshots for ${ctx.businessDate}`);

    return {
      result: {
        written,
        occupancyPct: manager.occupancyPct,
        inHouse: manager.inHouse,
        arrivals: manager.arrivals,
        departures: manager.departures,
      },
      totals: {
        snapshotsWritten: written,
        occupancyPct: manager.occupancyPct,
        inHouse: manager.inHouse,
        arrivals: manager.arrivals,
        departures: manager.departures,
      },
    };
  }
}
