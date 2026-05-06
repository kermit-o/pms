import { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { StepContext } from '../step';
import { SnapshotReportsStep } from './snapshot-reports';

function buildCtx() {
  const reservationCount = vi
    .fn()
    .mockResolvedValueOnce(3) // inHouse
    .mockResolvedValueOnce(2) // arrivals
    .mockResolvedValueOnce(1); // departures
  const folioEntryAggregate = vi.fn().mockResolvedValue({
    _sum: { amount: new Prisma.Decimal('500.00') },
    _count: { _all: 7 },
  });
  const roomCount = vi.fn().mockResolvedValue(10);
  const upsert = vi.fn().mockResolvedValue({});

  const tx = {
    reservation: { count: reservationCount },
    folioEntry: { aggregate: folioEntryAggregate },
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
    const { ctx, upsert } = buildCtx();
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
