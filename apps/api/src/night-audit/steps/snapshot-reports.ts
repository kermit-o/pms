import { Logger } from '@nestjs/common';
import { NightAuditReportType, NightAuditStep, Prisma, ReservationStatus } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('SnapshotReportsStep');

/**
 * Persists immutable snapshots of the 5 night-audit reports for the day.
 *
 * Sprint 3 W2 ships the schema + skeleton payloads (counts, totals). The
 * full report contents (occupancy %, ADR, RevPAR, tax breakdown, etc.)
 * land in W3-W4 — the snapshot row already exists, only the JSON payload
 * grows.
 *
 * Idempotency: night_audit_snapshots has UNIQUE (property, date,
 * reportType) so a re-run upserts the row in place; the night-audit run
 * row itself ensures we never call this with a stale runId.
 */
export class SnapshotReportsStep implements StepRunner {
  readonly step = NightAuditStep.SNAPSHOT_REPORTS;

  async run(ctx: StepContext): Promise<StepResult> {
    const [inHouse, arrivals, departures, charges] = await Promise.all([
      ctx.tx.reservation.count({
        where: {
          propertyId: ctx.propertyId,
          deletedAt: null,
          status: ReservationStatus.CHECKED_IN,
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
      ctx.tx.folioEntry.aggregate({
        where: {
          tenantId: ctx.user.tenantId,
          postedAt: {
            gte: startOfUtcDay(ctx.businessDateAsDate),
            lt: endOfUtcDay(ctx.businessDateAsDate),
          },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const totalRooms = await ctx.tx.room.count({
      where: { propertyId: ctx.propertyId, deletedAt: null },
    });
    const occupancyPct = totalRooms === 0 ? 0 : Math.round((inHouse / totalRooms) * 10000) / 10000;

    const generatedAt = new Date();

    const payloads: Record<NightAuditReportType, Prisma.InputJsonValue> = {
      MANAGER: {
        businessDate: ctx.businessDate,
        inHouse,
        arrivals,
        departures,
        totalRooms,
        occupancyPct,
        chargesPostedToday: charges._count._all,
        chargesTotalAmount: charges._sum.amount?.toString() ?? '0',
      },
      IN_HOUSE: {
        businessDate: ctx.businessDate,
        count: inHouse,
        // Detail rows in W4.
      },
      ARRIVALS_DEPARTURES: {
        businessDate: ctx.businessDate,
        arrivals,
        departures,
      },
      REVENUE: {
        businessDate: ctx.businessDate,
        chargeCount: charges._count._all,
        totalAmount: charges._sum.amount?.toString() ?? '0',
      },
      TAX: {
        businessDate: ctx.businessDate,
        // Detail breakdown in W3 once POST_TAXES output is stable.
      },
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
      result: { written, occupancyPct, inHouse, arrivals, departures },
      totals: {
        snapshotsWritten: written,
        occupancyPct,
        inHouse,
        arrivals,
        departures,
      },
    };
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}
