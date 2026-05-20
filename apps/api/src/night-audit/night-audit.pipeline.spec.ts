import { FolioStatus, NightAuditRunStatus, NightAuditStep, Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { AnomalyMetrics } from './anomaly.metrics';
import { AnomalyService } from './anomaly.service';
import { NightAuditService } from './night-audit.service';

/**
 * Pipeline-level integration test for the night-audit orchestrator.
 *
 * This isn't a real Testcontainers run (those land alongside the e2e
 * Playwright suite when the integration harness is wired in production),
 * but it walks all 6 steps with realistic Prisma-shaped fakes and verifies
 * the contract that matters most for Sprint 3 W6:
 *
 *  - the full happy path produces COMPLETED + 6 step_completed events,
 *  - re-running over a COMPLETED row is idempotent at the service surface
 *    (no second create, no second event emission),
 *  - the run row carries totals propagated from each step.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const RESERVATION_ID = '44444444-4444-4444-4444-444444444444';
const FOLIO_ID = '55555555-5555-5555-5555-555555555555';
const RUN_ID = '66666666-6666-6666-6666-666666666666';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'auditor@hotel.test',
  roles: ['night_auditor'],
};

function buildFakes() {
  let stepRowCounter = 0;
  const stepRows: Array<{
    id: string;
    runId: string;
    step: NightAuditStep;
    status: string;
    result: unknown;
  }> = [];

  let runRow: {
    id: string;
    propertyId: string;
    businessDate: Date;
    status: NightAuditRunStatus;
    startedAt: Date | null;
    completedAt: Date | null;
    lastFailedStep: NightAuditStep | null;
    lastError: string | null;
    totals: Prisma.JsonValue | null;
  } | null = null;

  // Reservation fixture used for POST_ROOM_CHARGES, POST_TAXES, POST_PACKAGES.
  const reservation = {
    id: RESERVATION_ID,
    currency: 'EUR',
    adults: 2,
    children: 0,
    roomType: {
      defaultRate: new Prisma.Decimal('100.00'),
      defaultCurrency: 'EUR',
      attributes: null,
    },
    ratePlan: {
      attributes: {
        taxRate: 0.1,
        packages: [{ code: 'BB', name: 'Breakfast', amount: 8 }],
      },
    },
    folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
  };

  // folio_entries created during this run (so POST_TAXES can find the
  // matching room charge by idempotencyKey).
  const folioEntries = new Map<string, { amount: Prisma.Decimal }>();

  const tx = {
    nightAuditRun: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(runRow)),
      create: vi.fn().mockImplementation(({ data }) => {
        runRow = {
          id: RUN_ID,
          propertyId: data.propertyId,
          businessDate: data.businessDate,
          status: NightAuditRunStatus.IN_PROGRESS,
          startedAt: data.startedAt ?? new Date(),
          completedAt: null,
          lastFailedStep: null,
          lastError: null,
          totals: null,
        };
        return Promise.resolve(runRow);
      }),
      update: vi.fn().mockImplementation(({ data }) => {
        if (!runRow) throw new Error('runRow not initialised');
        runRow = {
          ...runRow,
          ...data,
          completedAt: data.completedAt ?? runRow.completedAt ?? null,
        };
        return Promise.resolve(runRow);
      }),
    },
    nightAuditRunStep: {
      findFirst: vi.fn().mockImplementation(({ where }) => {
        const found = stepRows.find((r) => r.runId === where.runId && r.step === where.step);
        return Promise.resolve(found ?? null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        const row = {
          id: `step-${++stepRowCounter}`,
          runId: data.runId,
          step: data.step,
          status: 'PENDING',
          result: null,
        };
        stepRows.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const row = stepRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    reservation: {
      findMany: vi.fn().mockImplementation(({ select }) => {
        // Manager / In-house / Arrivals-Departures generators ask for
        // {room, guests, folio} or {guests} — return empty, the snapshot
        // step still works.
        if (select?.guests) return Promise.resolve([]);
        return Promise.resolve([reservation]);
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockImplementation(({ where }) => {
        if (where?.cancelledAt) return Promise.resolve(0);
        if (where?.status === 'CHECKED_IN') return Promise.resolve(1);
        if (where?.arrivalDate && !where?.departureDate) return Promise.resolve(0);
        if (where?.departureDate && !where?.arrivalDate) return Promise.resolve(0);
        return Promise.resolve(0);
      }),
    },
    folioEntry: {
      findFirst: vi.fn().mockImplementation(({ where, select }) => {
        if (typeof where?.idempotencyKey === 'string') {
          const found = folioEntries.get(where.idempotencyKey);
          if (found && select?.amount) {
            return Promise.resolve({ amount: found.amount });
          }
          if (found) return Promise.resolve({ id: where.idempotencyKey });
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        if (data.idempotencyKey) {
          folioEntries.set(data.idempotencyKey, {
            amount: new Prisma.Decimal(data.amount),
          });
        }
        return Promise.resolve({ id: 'entry-x' });
      }),
      aggregate: vi.fn().mockResolvedValue({
        _sum: { amount: new Prisma.Decimal(0) },
        _count: { _all: 0 },
      }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    folio: { update: vi.fn().mockResolvedValue({}) },
    room: { count: vi.fn().mockResolvedValue(10) },
    nightAuditSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
    nightAuditAnomaly: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    businessDayState: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    cashDrawerReconciliation: {
      findFirst: vi.fn().mockResolvedValue({
        discrepancy: new Prisma.Decimal(0),
        expectedAmount: new Prisma.Decimal(0),
        countedAmount: new Prisma.Decimal(0),
        toleranceCents: 0,
        currency: 'EUR',
      }),
    },
  };

  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const channelManager = {
    pushDelta: vi.fn().mockResolvedValue(undefined),
    runNightlyPush: vi.fn().mockResolvedValue(undefined),
    processInboundBooking: vi.fn(),
  };
  const service = new NightAuditService(
    prisma as never,
    events as never,
    new AnomalyService(),
    new AnomalyMetrics(),
    channelManager as never,
  );
  return { service, tx, events, getRunRow: () => runRow };
}

describe('NightAuditService — full pipeline integration', () => {
  it('walks all 7 steps end-to-end and reports totals from each step', async () => {
    const { service, tx, events } = buildFakes();
    const summary = await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });

    expect(summary.status).toBe(NightAuditRunStatus.COMPLETED);
    // 1 room charge + 1 tax + 1 package CHARGE.
    expect(tx.folioEntry.create).toHaveBeenCalledTimes(3);
    expect(tx.businessDayState.create).toHaveBeenCalledOnce();

    // 1 run_started + 7 step_completed (incluye DETECT_ANOMALIES) + 1 run_completed.
    const types = events.publish.mock.calls.map((c) => c[0]);
    expect(types[0]).toBe('night_audit.run_started');
    expect(types.at(-1)).toBe('night_audit.run_completed');
    expect(types.filter((t) => t === 'night_audit.step_completed')).toHaveLength(7);

    // Totals propagated from each step into NightAuditRun.totals.
    expect(summary.totals.roomChargesPosted).toBe(1);
    expect(summary.totals.taxesPosted).toBe(1);
    expect(summary.totals.packagesPosted).toBe(1);
    expect(summary.totals.snapshotsWritten).toBe(5);
  });

  it('is idempotent at the service surface when the day is already COMPLETED', async () => {
    const { service, tx, events } = buildFakes();
    await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });

    const createCallsBefore = tx.folioEntry.create.mock.calls.length;
    const eventCountBefore = events.publish.mock.calls.length;

    const second = await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });

    expect(second.status).toBe(NightAuditRunStatus.COMPLETED);
    expect(tx.folioEntry.create.mock.calls.length).toBe(createCallsBefore);
    expect(events.publish.mock.calls.length).toBe(eventCountBefore);
  });
});
