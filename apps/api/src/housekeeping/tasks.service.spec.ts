import { ConflictException, NotFoundException } from '@nestjs/common';
import { HousekeepingTaskStatus, HousekeepingTaskType } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { HousekeepingTasksService } from './tasks.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const ROOM_ID = '44444444-4444-4444-4444-444444444444';
const TASK_ID = '55555555-5555-5555-5555-555555555555';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'hsk@hotel.test',
  roles: ['housekeeping_supervisor'],
};

interface ExistingTaskOpts {
  id?: string;
  status?: HousekeepingTaskStatus;
  startedAt?: Date | null;
  taskType?: HousekeepingTaskType;
}

function buildExistingTask(opts: ExistingTaskOpts = {}) {
  return {
    id: opts.id ?? TASK_ID,
    propertyId: PROPERTY_ID,
    roomId: ROOM_ID,
    businessDate: new Date('2026-06-10'),
    taskType: opts.taskType ?? HousekeepingTaskType.CHECKOUT_CLEAN,
    status: opts.status ?? HousekeepingTaskStatus.PENDING,
    assignedToUserId: USER_ID,
    assignedAt: new Date(),
    startedAt: opts.startedAt ?? null,
    completedAt: null,
    durationMin: null,
    scheduledFor: null,
    notes: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildService(
  opts: {
    room?: { id: string } | null;
    existingTask?: ReturnType<typeof buildExistingTask> | null;
    duplicateOnCreate?: boolean;
  } = {},
) {
  const roomFindFirst = vi
    .fn()
    .mockResolvedValue(opts.room === undefined ? { id: ROOM_ID } : opts.room);
  const roomUpdate = vi.fn().mockResolvedValue({});

  let stored = opts.existingTask ?? null;
  const taskFindFirst = vi.fn().mockImplementation(() => {
    return Promise.resolve(stored);
  });
  const taskCreate = vi.fn().mockImplementation(({ data }) => {
    if (opts.duplicateOnCreate) {
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    }
    stored = {
      ...buildExistingTask(),
      ...data,
      id: TASK_ID,
      businessDate: data.businessDate,
      assignedAt: data.assignedToUserId ? new Date() : null,
    } as never;
    return Promise.resolve(stored);
  });
  const taskFindMany = vi.fn().mockResolvedValue([]);
  const taskUpdate = vi.fn().mockImplementation(({ data }) => {
    if (stored) {
      stored = { ...stored, ...data };
    }
    return Promise.resolve(stored);
  });

  const tx = {
    room: { findFirst: roomFindFirst, update: roomUpdate },
    housekeepingTask: {
      findFirst: taskFindFirst,
      create: taskCreate,
      findMany: taskFindMany,
      update: taskUpdate,
    },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const metrics = {
    tasksAssigned: { add: vi.fn() },
    tasksStarted: { add: vi.fn() },
    tasksCompleted: { add: vi.fn() },
    tasksCancelled: { add: vi.fn() },
    taskDuration: { record: vi.fn() },
  };

  const service = new HousekeepingTasksService(prisma as never, events as never, metrics as never);
  return { service, tx, events, metrics };
}

describe('HousekeepingTasksService.create', () => {
  it('creates a PENDING task and emits task_assigned', async () => {
    const { service, tx, events } = buildService({});
    const out = await service.create(user, 'corr', {
      propertyId: PROPERTY_ID,
      roomId: ROOM_ID,
      businessDate: '2026-06-10',
      taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
      assignedToUserId: USER_ID,
    });
    expect(out.id).toBe(TASK_ID);
    expect(out.status).toBe(HousekeepingTaskStatus.PENDING);
    expect(tx.housekeepingTask.create).toHaveBeenCalledOnce();
    expect(events.publish).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('housekeeping.task_assigned');
  });

  it('reuses existing task for the same (property, date, room, type) and does NOT emit a duplicate event', async () => {
    const existing = buildExistingTask();
    const { service, tx, events } = buildService({ existingTask: existing });
    const out = await service.create(user, 'corr', {
      propertyId: PROPERTY_ID,
      roomId: ROOM_ID,
      businessDate: '2026-06-10',
      taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
    });
    expect(out.id).toBe(TASK_ID);
    expect(tx.housekeepingTask.create).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('rejects when room does not exist in property', async () => {
    const { service } = buildService({ room: null });
    await expect(
      service.create(user, 'corr', {
        propertyId: PROPERTY_ID,
        roomId: ROOM_ID,
        businessDate: '2026-06-10',
        taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('HousekeepingTasksService.start', () => {
  it('moves PENDING -> IN_PROGRESS, sets startedAt, emits task_started', async () => {
    const { service, events } = buildService({
      existingTask: buildExistingTask({ status: HousekeepingTaskStatus.PENDING }),
    });
    const out = await service.start(user, 'corr', TASK_ID);
    expect(out.status).toBe(HousekeepingTaskStatus.IN_PROGRESS);
    expect(events.publish.mock.calls[0]![0]).toBe('housekeeping.task_started');
  });

  it('is idempotent on already IN_PROGRESS tasks', async () => {
    const { service, events } = buildService({
      existingTask: buildExistingTask({
        status: HousekeepingTaskStatus.IN_PROGRESS,
        startedAt: new Date('2026-06-10T08:00:00Z'),
      }),
    });
    const out = await service.start(user, 'corr', TASK_ID);
    expect(out.status).toBe(HousekeepingTaskStatus.IN_PROGRESS);
    // Even idempotent, the event still emits — that's the contract.
    expect(events.publish).toHaveBeenCalledOnce();
  });

  it('rejects start on COMPLETED task', async () => {
    const { service } = buildService({
      existingTask: buildExistingTask({ status: HousekeepingTaskStatus.COMPLETED }),
    });
    await expect(service.start(user, 'corr', TASK_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('HousekeepingTasksService.complete', () => {
  it('moves IN_PROGRESS -> COMPLETED, sets durationMin, transitions room, records metrics', async () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000);
    const { service, tx, events, metrics } = buildService({
      existingTask: buildExistingTask({
        status: HousekeepingTaskStatus.IN_PROGRESS,
        startedAt,
      }),
    });
    const out = await service.complete(user, 'corr', TASK_ID, {
      resultingRoomStatus: 'CLEAN',
    });
    expect(out.status).toBe(HousekeepingTaskStatus.COMPLETED);
    expect(out.durationMin).toBeGreaterThanOrEqual(29);
    expect(tx.room.update).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('housekeeping.task_completed');
    expect(metrics.tasksCompleted.add).toHaveBeenCalledOnce();
    expect(metrics.taskDuration.record).toHaveBeenCalledOnce();
  });

  it('rejects complete on PENDING task', async () => {
    const { service } = buildService({
      existingTask: buildExistingTask({ status: HousekeepingTaskStatus.PENDING }),
    });
    await expect(service.complete(user, 'corr', TASK_ID, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('HousekeepingTasksService.reassign', () => {
  it('reassigns a PENDING task and re-emits task_assigned', async () => {
    const { service, events } = buildService({
      existingTask: buildExistingTask({ status: HousekeepingTaskStatus.PENDING }),
    });
    const NEW_USER = '99999999-9999-9999-9999-999999999999';
    const out = await service.reassign(user, 'corr', TASK_ID, {
      assignedToUserId: NEW_USER,
    });
    expect(out.assignedToUserId).toBe(NEW_USER);
    expect(events.publish.mock.calls[0]![0]).toBe('housekeeping.task_assigned');
  });

  it('rejects reassign on COMPLETED task', async () => {
    const { service } = buildService({
      existingTask: buildExistingTask({ status: HousekeepingTaskStatus.COMPLETED }),
    });
    await expect(
      service.reassign(user, 'corr', TASK_ID, {
        assignedToUserId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('HousekeepingTasksService.summary', () => {
  it('aggregates by status, type, assignee and avg duration', async () => {
    const NEW_USER = '99999999-9999-9999-9999-999999999999';
    const { service, tx } = buildService({});
    tx.housekeepingTask.findMany.mockResolvedValueOnce([
      {
        status: HousekeepingTaskStatus.COMPLETED,
        taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
        durationMin: 30,
        assignedToUserId: USER_ID,
      },
      {
        status: HousekeepingTaskStatus.COMPLETED,
        taskType: HousekeepingTaskType.STAYOVER_CLEAN,
        durationMin: 20,
        assignedToUserId: USER_ID,
      },
      {
        status: HousekeepingTaskStatus.PENDING,
        taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
        durationMin: null,
        assignedToUserId: NEW_USER,
      },
      {
        status: HousekeepingTaskStatus.IN_PROGRESS,
        taskType: HousekeepingTaskType.INSPECTION,
        durationMin: null,
        assignedToUserId: null,
      },
    ]);
    const out = await service.summary(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(out.total).toBe(4);
    expect(out.byStatus.COMPLETED).toBe(2);
    expect(out.byStatus.PENDING).toBe(1);
    expect(out.byStatus.IN_PROGRESS).toBe(1);
    expect(out.byType.CHECKOUT_CLEAN).toBe(2);
    expect(out.avgDurationMin).toBe(25);
    const me = out.byAssignee.find((a) => a.userId === USER_ID);
    expect(me).toMatchObject({ total: 2, completed: 2 });
    const unassigned = out.byAssignee.find((a) => a.userId === null);
    expect(unassigned).toMatchObject({ total: 1, completed: 0 });
  });
});

describe('HousekeepingTasksService.suggestAssignments', () => {
  const PROP = PROPERTY_ID;
  const DATE = '2026-06-10';
  const ROOM_TYPE_STD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ROOM_TYPE_DLX = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const USER_A = '99999999-9999-9999-9999-999999999991';
  const USER_B = '99999999-9999-9999-9999-999999999992';

  function pendingTask(
    id: string,
    roomNumber: string,
    floor: string | null,
    roomTypeId: string,
    taskType: HousekeepingTaskType = HousekeepingTaskType.CHECKOUT_CLEAN,
    assignedToUserId: string | null = null,
  ) {
    return {
      id,
      taskType,
      assignedToUserId,
      room: {
        id: `room-${roomNumber}`,
        number: roomNumber,
        floor,
        roomTypeId,
      },
    };
  }

  function historicTask(taskType: HousekeepingTaskType, roomTypeId: string, durationMin: number) {
    return { taskType, durationMin, room: { roomTypeId } };
  }

  it('greedy assigns PENDING tasks balanceando carga, ordenadas por planta+numero', async () => {
    const { service, tx } = buildService({});
    // Llamada 1: PENDING tasks
    tx.housekeepingTask.findMany.mockResolvedValueOnce([
      pendingTask('t-201', '201', '2', ROOM_TYPE_STD),
      pendingTask('t-101', '101', '1', ROOM_TYPE_STD),
      pendingTask('t-102', '102', '1', ROOM_TYPE_DLX),
    ] as never);
    // Llamada 2: histórico (mediana 30 min para STD, 50 min para DLX).
    tx.housekeepingTask.findMany.mockResolvedValueOnce([
      historicTask(HousekeepingTaskType.CHECKOUT_CLEAN, ROOM_TYPE_STD, 30),
      historicTask(HousekeepingTaskType.CHECKOUT_CLEAN, ROOM_TYPE_STD, 30),
      historicTask(HousekeepingTaskType.CHECKOUT_CLEAN, ROOM_TYPE_DLX, 50),
    ] as never);

    const out = await service.suggestAssignments(user, 'corr', {
      propertyId: PROP,
      businessDate: DATE,
      candidateUserIds: [USER_A, USER_B],
      shiftCapacityMin: 290,
      lookbackDays: 30,
    });

    expect(out.suggestions).toHaveLength(3);
    // Orden por planta + numero: 101, 102, 201.
    expect(out.suggestions.map((s) => s.roomNumber)).toEqual(['101', '102', '201']);
    // Greedy: 101 (30 min) → A; 102 (50 min) → B (carga 0 vs A 30); 201 (30) → A (60 vs 50).
    expect(out.suggestions[0]!.suggestedUserId).toBe(USER_A);
    expect(out.suggestions[1]!.suggestedUserId).toBe(USER_B);
    expect(out.suggestions[2]!.suggestedUserId).toBe(USER_A);
    // Predicted min usa medianas calculadas.
    expect(out.suggestions[1]!.predictedMin).toBe(50);
    // No hay unmatched.
    expect(out.unmatched).toHaveLength(0);
  });

  it('marca como unmatched cuando se agota la capacidad', async () => {
    const { service, tx } = buildService({});
    // 5 tareas pesadas (60 min cada una) y solo 1 camarera con capacidad 120 min.
    tx.housekeepingTask.findMany.mockResolvedValueOnce([
      pendingTask('t1', '101', '1', ROOM_TYPE_STD),
      pendingTask('t2', '102', '1', ROOM_TYPE_STD),
      pendingTask('t3', '103', '1', ROOM_TYPE_STD),
      pendingTask('t4', '104', '1', ROOM_TYPE_STD),
      pendingTask('t5', '105', '1', ROOM_TYPE_STD),
    ] as never);
    tx.housekeepingTask.findMany.mockResolvedValueOnce([
      historicTask(HousekeepingTaskType.CHECKOUT_CLEAN, ROOM_TYPE_STD, 60),
    ] as never);

    const out = await service.suggestAssignments(user, 'corr', {
      propertyId: PROP,
      businessDate: DATE,
      candidateUserIds: [USER_A],
      shiftCapacityMin: 120,
      lookbackDays: 30,
    });

    expect(out.suggestions).toHaveLength(2); // 2x60 = 120 min, cabe.
    expect(out.unmatched).toHaveLength(3);
    expect(out.unmatched[0]!.reason).toBe('capacity_exhausted');
  });

  it('todas unmatched con reason=no_candidates si no hay camareras', async () => {
    const { service, tx } = buildService({});
    tx.housekeepingTask.findMany.mockResolvedValueOnce([
      pendingTask('t1', '101', '1', ROOM_TYPE_STD),
    ] as never);
    // Llamada 2 (deriva candidatas del dia) → vacio.
    tx.housekeepingTask.findMany.mockResolvedValueOnce([] as never);
    // Llamada 3 (historico) → vacio.
    tx.housekeepingTask.findMany.mockResolvedValueOnce([] as never);

    const out = await service.suggestAssignments(user, 'corr', {
      propertyId: PROP,
      businessDate: DATE,
      shiftCapacityMin: 290,
      lookbackDays: 30,
    });

    expect(out.suggestions).toHaveLength(0);
    expect(out.unmatched).toHaveLength(1);
    expect(out.unmatched[0]!.reason).toBe('no_candidates');
    // Sin historico cae al fallback de 30 min.
    expect(out.unmatched[0]!.predictedMin).toBe(30);
  });

  it('usa el fallback de 30 min cuando no hay historico para (taskType, roomType)', async () => {
    const { service, tx } = buildService({});
    tx.housekeepingTask.findMany.mockResolvedValueOnce([
      pendingTask(
        't1',
        '101',
        '1',
        ROOM_TYPE_STD,
        HousekeepingTaskType.MAINTENANCE, // sin historico
      ),
    ] as never);
    tx.housekeepingTask.findMany.mockResolvedValueOnce([] as never);

    const out = await service.suggestAssignments(user, 'corr', {
      propertyId: PROP,
      businessDate: DATE,
      candidateUserIds: [USER_A],
      shiftCapacityMin: 290,
      lookbackDays: 30,
    });
    expect(out.suggestions[0]!.predictedMin).toBe(30);
    expect(out.defaultDurationMin).toBe(30);
  });
});

describe('HousekeepingTasksService.cancel', () => {
  it('cancels a PENDING task and emits task_cancelled', async () => {
    const { service, events } = buildService({
      existingTask: buildExistingTask({ status: HousekeepingTaskStatus.PENDING }),
    });
    await service.cancel(user, 'corr', TASK_ID, { reason: 'OOO' });
    expect(events.publish.mock.calls[0]![0]).toBe('housekeeping.task_cancelled');
  });

  it('rejects cancel on COMPLETED task', async () => {
    const { service } = buildService({
      existingTask: buildExistingTask({ status: HousekeepingTaskStatus.COMPLETED }),
    });
    await expect(service.cancel(user, 'corr', TASK_ID, { reason: 'oops' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
