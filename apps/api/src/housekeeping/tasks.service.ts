import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HousekeepingTaskStatus, HousekeepingTaskType, Prisma, RoomStatus } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import {
  CancelTaskDto,
  CompleteTaskDto,
  CreateTaskDto,
  ListTasksQuery,
  ReassignTaskDto,
  SummaryQuery,
} from './dto';
import { HousekeepingMetrics } from './metrics';

/**
 * Housekeeping tasks service. Sprint 4 W1.
 *
 * State machine:
 *   PENDING -> IN_PROGRESS  (start, by assigned user)
 *   IN_PROGRESS -> COMPLETED (complete, sets durationMin and optionally
 *                             transitions room.status)
 *   PENDING/IN_PROGRESS -> CANCELLED (supervisor anula)
 *
 * Idempotency: tasks for `(property, businessDate, room, taskType)` are
 * unique. Re-creating a task for the same scope returns the existing row
 * (no error) so the supervisor can re-trigger an auto-bootstrap safely.
 *
 * Bulk and auto-bootstrap (S4 W2) reuse `create()` under the hood.
 */
@Injectable()
export class HousekeepingTasksService {
  private readonly log = new Logger(HousekeepingTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
    private readonly metrics: HousekeepingMetrics,
  ) {}

  private labels(tenantId: string, propertyId: string) {
    return { tenant: tenantId, property: propertyId };
  }

  async create(user: AuthUser, correlationId: string, input: CreateTaskDto): Promise<TaskView> {
    const ctx = tenantCtx(user, correlationId);
    const businessDateAsDate = new Date(input.businessDate);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: input.roomId, propertyId: input.propertyId, deletedAt: null },
        select: { id: true },
      });
      if (!room) {
        throw new NotFoundException(
          `Room ${input.roomId} not found in property ${input.propertyId}`,
        );
      }

      const existing = await tx.housekeepingTask.findFirst({
        where: {
          propertyId: input.propertyId,
          businessDate: businessDateAsDate,
          roomId: input.roomId,
          taskType: input.taskType,
        },
      });
      if (existing) {
        return { row: existing, freshlyCreated: false };
      }

      const created = await tx.housekeepingTask.create({
        data: {
          tenantId: user.tenantId,
          propertyId: input.propertyId,
          roomId: input.roomId,
          businessDate: businessDateAsDate,
          taskType: input.taskType,
          status: HousekeepingTaskStatus.PENDING,
          assignedToUserId: input.assignedToUserId ?? null,
          assignedAt: input.assignedToUserId ? new Date() : null,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          notes: input.notes ?? null,
        },
      });
      return { row: created, freshlyCreated: true };
    });

    if (result.freshlyCreated) {
      await this.events.publish('housekeeping.task_assigned', ctx, {
        taskId: result.row.id,
        propertyId: result.row.propertyId,
        roomId: result.row.roomId,
        businessDate: input.businessDate,
        taskType: result.row.taskType,
        assignedToUserId: result.row.assignedToUserId,
        assignedAt: result.row.assignedAt?.toISOString() ?? new Date().toISOString(),
      });
      this.metrics.tasksAssigned.add(1, {
        ...this.labels(user.tenantId, result.row.propertyId),
        task_type: result.row.taskType,
      });
    }

    return toView(result.row);
  }

  async list(user: AuthUser, correlationId: string, query: ListTasksQuery): Promise<TaskView[]> {
    const ctx = tenantCtx(user, correlationId);
    const where: Prisma.HousekeepingTaskWhereInput = { deletedAt: null };
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.assignedToUserId) where.assignedToUserId = query.assignedToUserId;
    if (query.status) where.status = query.status;
    if (query.taskType) where.taskType = query.taskType;
    if (query.from || query.to) {
      where.businessDate = {};
      if (query.from) (where.businessDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.businessDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }

    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.housekeepingTask.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        take: query.limit,
      }),
    );
    return rows.map(toView);
  }

  async findOne(user: AuthUser, correlationId: string, id: string): Promise<TaskView> {
    const ctx = tenantCtx(user, correlationId);
    const row = await this.prisma.withTenant(ctx, (tx) =>
      tx.housekeepingTask.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) throw new NotFoundException(`Task ${id} not found`);
    return toView(row);
  }

  async start(user: AuthUser, correlationId: string, id: string): Promise<TaskView> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.housekeepingTask.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) throw new NotFoundException(`Task ${id} not found`);
      if (existing.status === HousekeepingTaskStatus.IN_PROGRESS) {
        return existing;
      }
      if (existing.status !== HousekeepingTaskStatus.PENDING) {
        throw new ConflictException(`Task in status ${existing.status} cannot be started`);
      }
      return tx.housekeepingTask.update({
        where: { id: existing.id },
        data: {
          status: HousekeepingTaskStatus.IN_PROGRESS,
          startedAt: new Date(),
          assignedToUserId: existing.assignedToUserId ?? user.sub,
        },
      });
    });

    await this.events.publish('housekeeping.task_started', ctx, {
      taskId: result.id,
      propertyId: result.propertyId,
      roomId: result.roomId,
      businessDate: result.businessDate.toISOString().slice(0, 10),
      startedByUserId: user.sub,
      startedAt: result.startedAt!.toISOString(),
    });
    this.metrics.tasksStarted.add(1, this.labels(user.tenantId, result.propertyId));

    return toView(result);
  }

  async complete(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: CompleteTaskDto,
  ): Promise<TaskView> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.housekeepingTask.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) throw new NotFoundException(`Task ${id} not found`);
      if (existing.status === HousekeepingTaskStatus.COMPLETED) {
        return existing;
      }
      if (existing.status !== HousekeepingTaskStatus.IN_PROGRESS) {
        throw new ConflictException(`Task in status ${existing.status} cannot be completed`);
      }

      const completedAt = new Date();
      const durationMin = existing.startedAt
        ? Math.max(1, Math.round((completedAt.getTime() - existing.startedAt.getTime()) / 60000))
        : null;

      const updated = await tx.housekeepingTask.update({
        where: { id: existing.id },
        data: {
          status: HousekeepingTaskStatus.COMPLETED,
          completedAt,
          durationMin,
          notes: input.notes ?? existing.notes,
        },
      });

      if (input.resultingRoomStatus) {
        const targetStatus = input.resultingRoomStatus;
        await tx.room.update({
          where: { id: existing.roomId },
          data: {
            status: RoomStatus[targetStatus as keyof typeof RoomStatus],
            isOutOfOrder: targetStatus === 'OUT_OF_ORDER' || targetStatus === 'OUT_OF_SERVICE',
          },
        });
      }

      return updated;
    });

    await this.events.publish('housekeeping.task_completed', ctx, {
      taskId: result.id,
      propertyId: result.propertyId,
      roomId: result.roomId,
      businessDate: result.businessDate.toISOString().slice(0, 10),
      completedByUserId: user.sub,
      completedAt: result.completedAt!.toISOString(),
      durationMin: result.durationMin ?? 0,
      resultingRoomStatus: input.resultingRoomStatus ?? null,
    });
    this.metrics.tasksCompleted.add(1, {
      ...this.labels(user.tenantId, result.propertyId),
      resulting_room_status: input.resultingRoomStatus ?? 'none',
    });
    if (result.durationMin != null) {
      this.metrics.taskDuration.record(result.durationMin, {
        ...this.labels(user.tenantId, result.propertyId),
        task_type: result.taskType,
      });
    }

    return toView(result);
  }

  async cancel(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: CancelTaskDto,
  ): Promise<TaskView> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.housekeepingTask.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) throw new NotFoundException(`Task ${id} not found`);
      if (
        existing.status === HousekeepingTaskStatus.COMPLETED ||
        existing.status === HousekeepingTaskStatus.CANCELLED
      ) {
        throw new ConflictException(`Task in status ${existing.status} cannot be cancelled`);
      }
      return tx.housekeepingTask.update({
        where: { id: existing.id },
        data: {
          status: HousekeepingTaskStatus.CANCELLED,
          notes: input.reason,
        },
      });
    });

    await this.events.publish('housekeeping.task_cancelled', ctx, {
      taskId: result.id,
      propertyId: result.propertyId,
      roomId: result.roomId,
      businessDate: result.businessDate.toISOString().slice(0, 10),
      cancelledByUserId: user.sub,
      cancelledAt: new Date().toISOString(),
      reason: input.reason,
    });
    this.metrics.tasksCancelled.add(1, this.labels(user.tenantId, result.propertyId));

    return toView(result);
  }

  async reassign(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: ReassignTaskDto,
  ): Promise<TaskView> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.housekeepingTask.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) throw new NotFoundException(`Task ${id} not found`);
      if (
        existing.status === HousekeepingTaskStatus.COMPLETED ||
        existing.status === HousekeepingTaskStatus.CANCELLED
      ) {
        throw new ConflictException(`Task in status ${existing.status} cannot be reassigned`);
      }
      return tx.housekeepingTask.update({
        where: { id: existing.id },
        data: {
          assignedToUserId: input.assignedToUserId,
          assignedAt: input.assignedToUserId ? new Date() : null,
        },
      });
    });

    // Reuse task_assigned: a reassign is conceptually a re-emission of the
    // assignment fact. Consumers (timeline, audit) get the new owner.
    await this.events.publish('housekeeping.task_assigned', ctx, {
      taskId: result.id,
      propertyId: result.propertyId,
      roomId: result.roomId,
      businessDate: result.businessDate.toISOString().slice(0, 10),
      taskType: result.taskType,
      assignedToUserId: result.assignedToUserId,
      assignedAt: (result.assignedAt ?? new Date()).toISOString(),
    });

    return toView(result);
  }

  async summary(
    user: AuthUser,
    correlationId: string,
    query: SummaryQuery,
  ): Promise<TaskSummary> {
    const ctx = tenantCtx(user, correlationId);
    const businessDate = new Date(query.businessDate);

    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.housekeepingTask.findMany({
        where: {
          propertyId: query.propertyId,
          businessDate,
          deletedAt: null,
        },
        select: {
          status: true,
          taskType: true,
          durationMin: true,
          assignedToUserId: true,
        },
      }),
    );

    const byStatus: Record<HousekeepingTaskStatus, number> = {
      PENDING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    const byType: Record<HousekeepingTaskType, number> = {
      CHECKOUT_CLEAN: 0,
      STAYOVER_CLEAN: 0,
      INSPECTION: 0,
      MAINTENANCE: 0,
    };
    const byAssignee = new Map<string, { total: number; completed: number }>();
    let totalDurationMin = 0;
    let completedWithDuration = 0;

    for (const r of rows) {
      byStatus[r.status] += 1;
      byType[r.taskType] += 1;
      const key = r.assignedToUserId ?? '__unassigned__';
      const slot = byAssignee.get(key) ?? { total: 0, completed: 0 };
      slot.total += 1;
      if (r.status === HousekeepingTaskStatus.COMPLETED) slot.completed += 1;
      byAssignee.set(key, slot);
      if (r.durationMin != null && r.status === HousekeepingTaskStatus.COMPLETED) {
        totalDurationMin += r.durationMin;
        completedWithDuration += 1;
      }
    }

    return {
      propertyId: query.propertyId,
      businessDate: query.businessDate,
      total: rows.length,
      byStatus,
      byType,
      byAssignee: Array.from(byAssignee.entries()).map(([userId, v]) => ({
        userId: userId === '__unassigned__' ? null : userId,
        total: v.total,
        completed: v.completed,
      })),
      avgDurationMin:
        completedWithDuration > 0 ? Math.round(totalDurationMin / completedWithDuration) : null,
    };
  }
}

// ---------------------------------------------------------------------------

export interface TaskSummary {
  propertyId: string;
  businessDate: string;
  total: number;
  byStatus: Record<HousekeepingTaskStatus, number>;
  byType: Record<HousekeepingTaskType, number>;
  byAssignee: { userId: string | null; total: number; completed: number }[];
  avgDurationMin: number | null;
}

// ---------------------------------------------------------------------------

function tenantCtx(user: AuthUser, correlationId: string) {
  return { tenantId: user.tenantId, actorId: user.sub, correlationId };
}

export interface TaskView {
  id: string;
  propertyId: string;
  roomId: string;
  businessDate: string;
  taskType: HousekeepingTaskType;
  status: HousekeepingTaskStatus;
  assignedToUserId: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number | null;
  scheduledFor: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function toView(row: {
  id: string;
  propertyId: string;
  roomId: string;
  businessDate: Date;
  taskType: HousekeepingTaskType;
  status: HousekeepingTaskStatus;
  assignedToUserId: string | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMin: number | null;
  scheduledFor: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TaskView {
  return {
    id: row.id,
    propertyId: row.propertyId,
    roomId: row.roomId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    taskType: row.taskType,
    status: row.status,
    assignedToUserId: row.assignedToUserId,
    assignedAt: row.assignedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMin: row.durationMin,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
