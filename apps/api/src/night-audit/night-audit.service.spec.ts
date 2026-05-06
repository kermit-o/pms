import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  FolioStatus,
  NightAuditRunStatus,
  NightAuditStep,
  NightAuditStepStatus,
  Prisma,
  ReservationStatus,
} from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { NightAuditService } from './night-audit.service';

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

interface BuildOpts {
  existingRun?: {
    id: string;
    propertyId: string;
    businessDate: Date;
    status: NightAuditRunStatus;
    startedAt: Date | null;
    completedAt: Date | null;
    lastFailedStep: NightAuditStep | null;
    lastError: string | null;
    totals: Prisma.JsonValue | null;
  } | null;
  reservations?: Array<{
    id: string;
    currency: string;
    roomType: { defaultRate: Prisma.Decimal; defaultCurrency: string };
    ratePlan: { attributes: Prisma.JsonValue | null } | null;
    folio: { id: string; status: FolioStatus } | null;
  }>;
  existingEntry?: { id: string } | null;
  existingDay?: { status: 'OPEN' | 'CLOSED' } | null;
  /** Force the runner to throw the given message during step execution. */
  throwOnEntryCreate?: string;
}

function buildService(opts: BuildOpts = {}) {
  let stepRowCounter = 0;
  const stepRows: Array<{
    id: string;
    runId: string;
    step: NightAuditStep;
    status: NightAuditStepStatus;
  }> = [];

  function makeStepRow(runId: string, step: NightAuditStep) {
    const row = {
      id: `step-${++stepRowCounter}`,
      runId,
      step,
      status: NightAuditStepStatus.PENDING,
    };
    stepRows.push(row);
    return row;
  }

  const runRow = opts.existingRun ?? {
    id: RUN_ID,
    propertyId: PROPERTY_ID,
    businessDate: new Date('2026-06-10'),
    status: NightAuditRunStatus.PENDING,
    startedAt: null,
    completedAt: null,
    lastFailedStep: null,
    lastError: null,
    totals: null,
  };

  const tx = {
    nightAuditRun: {
      findFirst: vi.fn().mockResolvedValue(opts.existingRun ?? null),
      create: vi.fn().mockResolvedValue({
        ...runRow,
        status: NightAuditRunStatus.IN_PROGRESS,
        startedAt: new Date(),
      }),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...runRow,
          ...data,
          completedAt: data.completedAt ?? null,
        }),
      ),
    },
    nightAuditRunStep: {
      findFirst: vi.fn().mockImplementation(({ where }) => {
        const found = stepRows.find((r) => r.runId === where.runId && r.step === where.step);
        return Promise.resolve(found ?? null);
      }),
      create: vi
        .fn()
        .mockImplementation(({ data }) => Promise.resolve(makeStepRow(data.runId, data.step))),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const row = stepRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    reservation: {
      findMany: vi.fn().mockResolvedValue(opts.reservations ?? []),
    },
    folioEntry: {
      findFirst: vi.fn().mockResolvedValue(opts.existingEntry ?? null),
      create: vi.fn().mockImplementation(() => {
        if (opts.throwOnEntryCreate) {
          throw new Error(opts.throwOnEntryCreate);
        }
        return Promise.resolve({ id: 'entry-x' });
      }),
    },
    folio: {
      update: vi.fn().mockResolvedValue({}),
    },
    businessDayState: {
      findFirst: vi.fn().mockResolvedValue(opts.existingDay ?? null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const service = new NightAuditService(prisma as never, events as never);
  return { service, tx, events, stepRows };
}

describe('NightAuditService.run', () => {
  it('creates a run, executes pipeline, marks COMPLETED and emits run_completed', async () => {
    const { service, tx, events } = buildService({
      reservations: [
        {
          id: RESERVATION_ID,
          currency: 'EUR',
          roomType: {
            defaultRate: new Prisma.Decimal('100.00'),
            defaultCurrency: 'EUR',
          },
          ratePlan: null,
          folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
        },
      ],
    });

    const summary = await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });

    expect(summary.status).toBe(NightAuditRunStatus.COMPLETED);
    expect(tx.nightAuditRun.create).toHaveBeenCalledOnce();
    expect(tx.folioEntry.create).toHaveBeenCalledOnce();
    const charge = tx.folioEntry.create.mock.calls[0]![0].data;
    expect(charge.idempotencyKey).toBe(`na:room:2026-06-10:${RESERVATION_ID}`);
    expect(charge.amount.toString()).toBe('100');
    expect(tx.businessDayState.create).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls.map((c) => c[0])).toEqual([
      'night_audit.run_started',
      'night_audit.step_completed', // POST_ROOM_CHARGES
      'night_audit.step_completed', // POST_TAXES (stub)
      'night_audit.step_completed', // POST_PACKAGES (stub)
      'night_audit.step_completed', // MARK_NO_SHOWS (stub)
      'night_audit.step_completed', // SNAPSHOT_REPORTS (stub)
      'night_audit.step_completed', // CLOSE_DAY
      'night_audit.run_completed',
    ]);
  });

  it('skips POST_ROOM_CHARGES when idempotency key already exists', async () => {
    const { service, tx } = buildService({
      reservations: [
        {
          id: RESERVATION_ID,
          currency: 'EUR',
          roomType: {
            defaultRate: new Prisma.Decimal('100.00'),
            defaultCurrency: 'EUR',
          },
          ratePlan: null,
          folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
        },
      ],
      existingEntry: { id: 'already-posted' },
    });
    await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(tx.folioEntry.create).not.toHaveBeenCalled();
    expect(tx.folio.update).not.toHaveBeenCalled();
  });

  it('returns existing COMPLETED run as-is on a re-run (idempotent)', async () => {
    const completedAt = new Date('2026-06-10T10:00:00Z');
    const { service, tx, events } = buildService({
      existingRun: {
        id: RUN_ID,
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: NightAuditRunStatus.COMPLETED,
        startedAt: new Date('2026-06-10T09:00:00Z'),
        completedAt,
        lastFailedStep: null,
        lastError: null,
        totals: {},
      },
    });
    const summary = await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(summary.status).toBe(NightAuditRunStatus.COMPLETED);
    expect(tx.nightAuditRun.create).not.toHaveBeenCalled();
    expect(tx.folioEntry.create).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('marks run FAILED with lastFailedStep when a step throws', async () => {
    const { service, events } = buildService({
      reservations: [
        {
          id: RESERVATION_ID,
          currency: 'EUR',
          roomType: {
            defaultRate: new Prisma.Decimal('100.00'),
            defaultCurrency: 'EUR',
          },
          ratePlan: null,
          folio: { id: FOLIO_ID, status: FolioStatus.OPEN },
        },
      ],
      throwOnEntryCreate: 'boom',
    });
    const summary = await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(summary.status).toBe(NightAuditRunStatus.FAILED);
    expect(summary.lastFailedStep).toBe(NightAuditStep.POST_ROOM_CHARGES);
    expect(summary.lastError).toBe('boom');
    expect(events.publish.mock.calls.map((c) => c[0])).toContain('night_audit.step_failed');
  });

  it('CLOSE_DAY step transitions business_day_states to CLOSED', async () => {
    const { service, tx } = buildService({});
    await service.run(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(tx.businessDayState.create).toHaveBeenCalledOnce();
    const data = tx.businessDayState.create.mock.calls[0]![0].data;
    expect(data.status).toBe('CLOSED');
    expect(data.closedByUserId).toBe(USER_ID);
  });
});

describe('NightAuditService.resume', () => {
  it('throws NotFoundException for missing run', async () => {
    const { service } = buildService({ existingRun: null });
    await expect(service.resume(user, 'corr', RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException for already-COMPLETED run', async () => {
    const { service } = buildService({
      existingRun: {
        id: RUN_ID,
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: NightAuditRunStatus.COMPLETED,
        startedAt: new Date(),
        completedAt: new Date(),
        lastFailedStep: null,
        lastError: null,
        totals: {},
      },
    });
    await expect(service.resume(user, 'corr', RUN_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});
