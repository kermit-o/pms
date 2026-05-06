import { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { StepContext } from '../step';
import { SnapshotReportsStep } from './snapshot-reports';

interface CountOverrides {
  inHouse?: number;
  arrivals?: number;
  departures?: number;
  cancellations?: number;
  totalRooms?: number;
}

function buildCtx(overrides: CountOverrides = {}) {
  // The snapshot step + the report generators all share ctx.tx, so
  // reservation.count is invoked many times with different `where` clauses.
  // Disambiguate by inspecting the where shape so the test stays stable as
  // call order changes.
  const reservationCount = vi.fn().mockImplementation(({ where }) => {
    if (where?.cancelledAt) {
      return Promise.resolve(overrides.cancellations ?? 0);
    }
    if (where?.status === 'CHECKED_IN') {
      return Promise.resolve(overrides.inHouse ?? 0);
    }
    if (where?.arrivalDate && !where?.departureDate) {
      return Promise.resolve(overrides.arrivals ?? 0);
    }
    if (where?.departureDate && !where?.arrivalDate) {
      return Promise.resolve(overrides.departures ?? 0);
    }
    return Promise.resolve(0);
  });

  const folioEntryAggregate = vi.fn().mockResolvedValue({
    _sum: { amount: new Prisma.Decimal('500.00') },
    _count: { _all: 7 },
  });
  const folioEntryGroupBy = vi.fn().mockResolvedValue([]);
  const roomCount = vi.fn().mockResolvedValue(overrides.totalRooms ?? 10);
  const upsert = vi.fn().mockResolvedValue({});

  const tx = {
    reservation: { count: reservationCount },
    folioEntry: { aggregate: folioEntryAggregate, groupBy: folioEntryGroupBy },
    room: { count: roomCount },
    nightAuditSnapshot: { upsert },
  } as unknown as StepContext['tx'];

  const ctx: StepContext = {
    tx,
    user: {
      sub: 'user',
      tenantId: 'tenant',
      email: 'a@b',
      roles: ['night_auditor'],
    },
    correlationId: 'c',
    runId: 'run-1',
    propertyId: 'prop',
    businessDate: '2026-06-10',
    businessDateAsDate: new Date('2026-06-10'),
  };

  return { ctx, upsert };
}

describe('SnapshotReportsStep', () => {
  it('upserts one snapshot per report type and returns totals', async () => {
    const { ctx, upsert } = buildCtx({
      inHouse: 3,
      arrivals: 2,
      departures: 1,
      totalRooms: 10,
    });
    const out = await new SnapshotReportsStep().run(ctx);
    expect(upsert).toHaveBeenCalledTimes(5);
    const types = upsert.mock.calls.map(
      (c) => (c[0] as { create: { reportType: string } }).create.reportType,
    );
    expect(types.sort()).toEqual(['ARRIVALS_DEPARTURES', 'IN_HOUSE', 'MANAGER', 'REVENUE', 'TAX']);
    expect(out.totals?.snapshotsWritten).toBe(5);
    expect(out.totals?.inHouse).toBe(3);
    expect(out.totals?.arrivals).toBe(2);
    expect(out.totals?.departures).toBe(1);
    expect(out.totals?.occupancyPct).toBe(0.3);
  });
});
