import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NightAuditRunStatus, NightAuditStep, NightAuditStepStatus, Prisma } from '@pms/db';
import { ChannelManagerService } from '../channel-manager';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import { AnomalyMetrics } from './anomaly.metrics';
import { AnomalyService } from './anomaly.service';
import { ListAnomaliesQuery, ListRunsQuery, RunNightAuditDto } from './dto';
import type { StepContext, StepRunner } from './step';
import { CloseDayStep } from './steps/close-day';
import { DetectAnomaliesStep } from './steps/detect-anomalies';
import { MarkNoShowsStep } from './steps/mark-no-shows';
import { PostPackagesStep } from './steps/post-packages';
import { PostRoomChargesStep } from './steps/post-room-charges';
import { PostTaxesStep } from './steps/post-taxes';
import { SnapshotReportsStep } from './steps/snapshot-reports';

/**
 * Night audit orchestrator. Sprint 3 W1.
 *
 * Pipeline:
 *  1. POST_ROOM_CHARGES  (real)
 *  2. POST_TAXES         (stub)
 *  3. POST_PACKAGES      (stub)
 *  4. MARK_NO_SHOWS      (stub)
 *  5. SNAPSHOT_REPORTS   (stub)
 *  6. CLOSE_DAY          (real)
 *
 * Idempotency:
 *  - One NightAuditRun row per (property, businessDate). Re-calling run()
 *    over an existing IN_PROGRESS or FAILED run resumes from the next
 *    PENDING/FAILED step. COMPLETED runs return as-is.
 *  - Each step's COMPLETED state is persisted to night_audit_run_steps,
 *    so the orchestrator never re-executes a completed step.
 *  - Inside each step, idempotency keys (e.g. folio_entries.idempotency_key)
 *    keep the database in a consistent state if the orchestrator itself is
 *    interrupted between two writes.
 *
 * Defence in depth: a transaction wraps the whole step body so a failure
 * inside a step rolls back its DB writes; the orchestrator persists the
 * step's status (FAILED) on a separate, non-transactional withTenant call.
 */
@Injectable()
export class NightAuditService {
  private readonly log = new Logger(NightAuditService.name);

  private readonly pipeline: StepRunner[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
    private readonly anomaly: AnomalyService,
    private readonly anomalyMetrics: AnomalyMetrics,
    private readonly channelManager: ChannelManagerService,
  ) {
    this.pipeline = [
      new PostRoomChargesStep(),
      new PostTaxesStep(),
      new PostPackagesStep(),
      new MarkNoShowsStep(),
      new SnapshotReportsStep(),
      new DetectAnomaliesStep(this.anomaly, this.anomalyMetrics),
      new CloseDayStep(),
    ];
  }

  async run(user: AuthUser, correlationId: string, input: RunNightAuditDto): Promise<RunSummary> {
    const ctx = tenantCtx(user, correlationId);
    const businessDateAsDate = new Date(input.businessDate);

    // 1. Find or create the run row.
    const run = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.nightAuditRun.findFirst({
        where: {
          propertyId: input.propertyId,
          businessDate: businessDateAsDate,
        },
      });
      if (existing && existing.status === NightAuditRunStatus.COMPLETED) {
        return { row: existing, freshlyCreated: false };
      }
      if (existing) {
        const reset = await tx.nightAuditRun.update({
          where: { id: existing.id },
          data: {
            status: NightAuditRunStatus.IN_PROGRESS,
            startedAt: existing.startedAt ?? new Date(),
            lastFailedStep: null,
            lastError: null,
          },
        });
        return { row: reset, freshlyCreated: false };
      }
      const created = await tx.nightAuditRun.create({
        data: {
          tenantId: user.tenantId,
          propertyId: input.propertyId,
          businessDate: businessDateAsDate,
          status: NightAuditRunStatus.IN_PROGRESS,
          startedAt: new Date(),
          startedByUserId: user.sub,
        },
      });
      return { row: created, freshlyCreated: true };
    });

    if (run.row.status === NightAuditRunStatus.COMPLETED) {
      return toSummary(run.row, []);
    }

    if (run.freshlyCreated) {
      await this.events.publish('night_audit.run_started', ctx, {
        runId: run.row.id,
        propertyId: input.propertyId,
        businessDate: input.businessDate,
        startedAt: run.row.startedAt!.toISOString(),
        startedByUserId: user.sub,
      });
    }

    // 2. Execute pipeline.
    const totals: Record<string, number | string> = {
      ...((run.row.totals as Record<string, number | string> | null) ?? {}),
    };
    const stepRows: { step: NightAuditStep; status: NightAuditStepStatus }[] = [];

    for (const runner of this.pipeline) {
      const stepRow = await this.upsertStepRow(ctx, run.row.id, user.tenantId, runner.step);
      if (stepRow.status === NightAuditStepStatus.COMPLETED) {
        stepRows.push({ step: runner.step, status: stepRow.status });
        continue;
      }

      const startedAt = Date.now();
      try {
        await this.prisma.withTenant(ctx, async (tx) => {
          await tx.nightAuditRunStep.update({
            where: { id: stepRow.id },
            data: {
              status: NightAuditStepStatus.RUNNING,
              startedAt: new Date(),
              error: null,
            },
          });

          const stepCtx: StepContext = {
            tx,
            user,
            correlationId,
            runId: run.row.id,
            propertyId: input.propertyId,
            businessDate: input.businessDate,
            businessDateAsDate,
          };
          const out = await runner.run(stepCtx);

          await tx.nightAuditRunStep.update({
            where: { id: stepRow.id },
            data: {
              status: NightAuditStepStatus.COMPLETED,
              completedAt: new Date(),
              durationMs: Date.now() - startedAt,
              result:
                out.result === undefined ? Prisma.JsonNull : (out.result as Prisma.InputJsonValue),
            },
          });
          if (out.totals) {
            for (const [k, v] of Object.entries(out.totals)) totals[k] = v;
          }
        });

        await this.events.publish('night_audit.step_completed', ctx, {
          runId: run.row.id,
          propertyId: input.propertyId,
          businessDate: input.businessDate,
          step: runner.step,
          durationMs: Date.now() - startedAt,
        });
        stepRows.push({
          step: runner.step,
          status: NightAuditStepStatus.COMPLETED,
        });
      } catch (err) {
        const message = (err as Error).message;
        await this.prisma.withTenant(ctx, async (tx) => {
          await tx.nightAuditRunStep.update({
            where: { id: stepRow.id },
            data: {
              status: NightAuditStepStatus.FAILED,
              error: message,
              durationMs: Date.now() - startedAt,
            },
          });
          await tx.nightAuditRun.update({
            where: { id: run.row.id },
            data: {
              status: NightAuditRunStatus.FAILED,
              lastFailedStep: runner.step,
              lastError: message,
              totals,
            },
          });
        });
        await this.events.publish('night_audit.step_failed', ctx, {
          runId: run.row.id,
          propertyId: input.propertyId,
          businessDate: input.businessDate,
          step: runner.step,
          error: message,
        });
        return toSummary(
          {
            ...run.row,
            status: NightAuditRunStatus.FAILED,
            lastFailedStep: runner.step,
            lastError: message,
            totals,
          },
          stepRows,
        );
      }
    }

    // 3. Mark the run completed.
    const completedRun = await this.prisma.withTenant(ctx, (tx) =>
      tx.nightAuditRun.update({
        where: { id: run.row.id },
        data: {
          status: NightAuditRunStatus.COMPLETED,
          completedAt: new Date(),
          completedByUserId: user.sub,
          totals,
          lastFailedStep: null,
          lastError: null,
        },
      }),
    );

    await this.events.publish('night_audit.run_completed', ctx, {
      runId: run.row.id,
      propertyId: input.propertyId,
      businessDate: input.businessDate,
      completedAt: completedRun.completedAt!.toISOString(),
      totals,
    });

    // Tras CLOSE_DAY, hacer push completo de availability + rates al CM
    // si el hotel lo tiene configurado. No bloquea: errores se loguean
    // pero el NA queda cerrado igualmente.
    void this.channelManager
      .runNightlyPush(input.propertyId)
      .catch((err) =>
        this.log.warn(`channelManager.runNightlyPush failed: ${(err as Error).message}`),
      );

    return toSummary(completedRun, stepRows);
  }

  async resume(user: AuthUser, correlationId: string, runId: string): Promise<RunSummary> {
    const ctx = tenantCtx(user, correlationId);
    const existing = await this.prisma.withTenant(ctx, (tx) =>
      tx.nightAuditRun.findFirst({ where: { id: runId } }),
    );
    if (!existing) throw new NotFoundException(`Run ${runId} not found`);
    if (existing.status === NightAuditRunStatus.COMPLETED) {
      throw new ConflictException('Run already COMPLETED');
    }
    return this.run(user, correlationId, {
      propertyId: existing.propertyId,
      businessDate: existing.businessDate.toISOString().slice(0, 10),
    });
  }

  async findOne(user: AuthUser, correlationId: string, runId: string): Promise<RunSummary> {
    const ctx = tenantCtx(user, correlationId);
    const row = await this.prisma.withTenant(ctx, (tx) =>
      tx.nightAuditRun.findFirst({
        where: { id: runId },
        include: { steps: true },
      }),
    );
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    return toSummary(
      row,
      row.steps.map((s) => ({ step: s.step, status: s.status })),
    );
  }

  async list(user: AuthUser, correlationId: string, query: ListRunsQuery): Promise<RunSummary[]> {
    const ctx = tenantCtx(user, correlationId);
    const where: Prisma.NightAuditRunWhereInput = {};
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.businessDate = {};
      if (query.from) (where.businessDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.businessDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }
    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.nightAuditRun.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { startedAt: 'desc' }],
        take: query.limit,
        include: { steps: true },
      }),
    );
    return rows.map((r) =>
      toSummary(
        r,
        r.steps.map((s) => ({ step: s.step, status: s.status })),
      ),
    );
  }

  async listAnomalies(
    user: AuthUser,
    correlationId: string,
    query: ListAnomaliesQuery,
  ): Promise<AnomalyView[]> {
    const ctx = tenantCtx(user, correlationId);
    const where: Prisma.NightAuditAnomalyWhereInput = {};
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.businessDate) where.businessDate = new Date(query.businessDate);
    else if (query.from || query.to) {
      where.businessDate = {};
      if (query.from) (where.businessDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.businessDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }
    if (query.kind) where.kind = query.kind;
    if (query.severity) where.severity = query.severity;
    if (query.reviewed === 'yes') where.reviewedAt = { not: null };
    if (query.reviewed === 'no') where.reviewedAt = null;
    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.nightAuditAnomaly.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { severity: 'desc' }, { createdAt: 'desc' }],
        take: query.limit,
      }),
    );
    return rows.map(toAnomalyView);
  }

  async reviewAnomaly(
    user: AuthUser,
    correlationId: string,
    anomalyId: string,
    notes: string | undefined,
  ): Promise<AnomalyView> {
    const ctx = tenantCtx(user, correlationId);
    const updated = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.nightAuditAnomaly.findFirst({ where: { id: anomalyId } });
      if (!existing) throw new NotFoundException(`anomaly ${anomalyId} not found`);
      // Idempotente: si ya esta revisada, devolvemos como esta.
      if (existing.reviewedAt) return existing;
      return tx.nightAuditAnomaly.update({
        where: { id: anomalyId },
        data: {
          reviewedAt: new Date(),
          reviewedByUserId: user.sub,
          reviewNotes: notes ?? null,
        },
      });
    });
    return toAnomalyView(updated);
  }

  async getState(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    businessDate: string,
  ): Promise<{
    propertyId: string;
    businessDate: string;
    run: RunSummary | null;
  }> {
    const ctx = tenantCtx(user, correlationId);
    const row = await this.prisma.withTenant(ctx, (tx) =>
      tx.nightAuditRun.findFirst({
        where: { propertyId, businessDate: new Date(businessDate) },
        include: { steps: true },
      }),
    );
    return {
      propertyId,
      businessDate,
      run: row
        ? toSummary(
            row,
            row.steps.map((s) => ({ step: s.step, status: s.status })),
          )
        : null,
    };
  }

  // -------------------------------------------------------------------------

  private async upsertStepRow(
    ctx: { tenantId: string; actorId?: string | null; correlationId?: string | null },
    runId: string,
    tenantId: string,
    step: NightAuditStep,
  ) {
    return this.prisma.withTenant(ctx, async (tx) => {
      const found = await tx.nightAuditRunStep.findFirst({
        where: { runId, step },
      });
      if (found) return found;
      return tx.nightAuditRunStep.create({
        data: { tenantId, runId, step },
      });
    });
  }
}

// ---------------------------------------------------------------------------

function tenantCtx(user: AuthUser, correlationId: string) {
  return { tenantId: user.tenantId, actorId: user.sub, correlationId };
}

export interface RunSummary {
  id: string;
  propertyId: string;
  businessDate: string;
  status: NightAuditRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  lastFailedStep: NightAuditStep | null;
  lastError: string | null;
  totals: Record<string, unknown>;
  steps: { step: NightAuditStep; status: NightAuditStepStatus }[];
}

function toSummary(
  row: {
    id: string;
    propertyId: string;
    businessDate: Date;
    status: NightAuditRunStatus;
    startedAt: Date | null;
    completedAt: Date | null;
    lastFailedStep: NightAuditStep | null;
    lastError: string | null;
    totals: Prisma.JsonValue | null;
  },
  steps: { step: NightAuditStep; status: NightAuditStepStatus }[],
): RunSummary {
  return {
    id: row.id,
    propertyId: row.propertyId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    lastFailedStep: row.lastFailedStep,
    lastError: row.lastError,
    totals: (row.totals as Record<string, unknown> | null) ?? {},
    steps,
  };
}

export interface AnomalyView {
  id: string;
  propertyId: string;
  runId: string;
  businessDate: string;
  kind: string;
  severity: string;
  details: unknown;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

function toAnomalyView(row: {
  id: string;
  propertyId: string;
  runId: string;
  businessDate: Date;
  kind: string;
  severity: string;
  details: Prisma.JsonValue;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  reviewNotes: string | null;
  createdAt: Date;
}): AnomalyView {
  return {
    id: row.id,
    propertyId: row.propertyId,
    runId: row.runId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    kind: row.kind,
    severity: row.severity,
    details: row.details,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    reviewNotes: row.reviewNotes,
    createdAt: row.createdAt.toISOString(),
  };
}
