import { HousekeepingTaskStatus, HousekeepingTaskType } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { HskToolRouter } from './hsk-tool-router';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const ROOM_ID = '44444444-4444-4444-4444-444444444444';
const TASK_ID = '55555555-5555-5555-5555-555555555555';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'sup@hotel.test',
  roles: ['housekeeping_supervisor'],
};

function makeTasksMock() {
  return {
    create: vi.fn().mockResolvedValue({ id: TASK_ID, status: HousekeepingTaskStatus.PENDING }),
    start: vi.fn().mockResolvedValue({ id: TASK_ID, status: HousekeepingTaskStatus.IN_PROGRESS }),
    complete: vi.fn().mockResolvedValue({ id: TASK_ID, status: HousekeepingTaskStatus.COMPLETED }),
    list: vi.fn().mockResolvedValue([]),
    suggestAssignments: vi.fn().mockResolvedValue({ suggestions: [], unmatched: [] }),
  };
}

describe('HskToolRouter', () => {
  it('flags assign/start/complete as mutating, list_today + suggest as read-only', () => {
    const router = new HskToolRouter(makeTasksMock() as never);
    expect(router.isMutating('hsk_assign_task')).toBe(true);
    expect(router.isMutating('hsk_start_task')).toBe(true);
    expect(router.isMutating('hsk_complete_task')).toBe(true);
    expect(router.isMutating('hsk_list_today')).toBe(false);
    expect(router.isMutating('hsk_suggest_assignments')).toBe(false);
  });

  it('hsk_assign_task delegates to tasks.create with the same arguments', async () => {
    const tasks = makeTasksMock();
    const router = new HskToolRouter(tasks as never);
    await router.execute(
      'hsk_assign_task',
      {
        propertyId: PROPERTY_ID,
        roomId: ROOM_ID,
        businessDate: '2026-06-10',
        taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
      },
      user,
      'corr',
    );
    expect(tasks.create).toHaveBeenCalledOnce();
    expect(tasks.create.mock.calls[0]![2]).toMatchObject({
      propertyId: PROPERTY_ID,
      roomId: ROOM_ID,
      taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
    });
  });

  it('hsk_list_today defaults businessDate to today', async () => {
    const tasks = makeTasksMock();
    const router = new HskToolRouter(tasks as never);
    await router.execute('hsk_list_today', { propertyId: PROPERTY_ID }, user, 'corr');
    const call = tasks.list.mock.calls[0]![2];
    const today = new Date().toISOString().slice(0, 10);
    expect(call.from).toBe(today);
    expect(call.to).toBe(today);
  });

  it('rejects an unknown tool name', async () => {
    const router = new HskToolRouter(makeTasksMock() as never);
    await expect(router.execute('unknown' as never, {}, user, 'corr')).rejects.toThrow();
  });

  it('re-validates input via Zod (rejects malformed UUID)', async () => {
    const router = new HskToolRouter(makeTasksMock() as never);
    await expect(
      router.execute('hsk_start_task', { taskId: 'not-a-uuid' }, user, 'corr'),
    ).rejects.toThrow();
  });

  it('hsk_suggest_assignments delegates to tasks.suggestAssignments con businessDate default a hoy', async () => {
    const tasks = makeTasksMock();
    const router = new HskToolRouter(tasks as never);
    await router.execute('hsk_suggest_assignments', { propertyId: PROPERTY_ID }, user, 'corr');
    expect(tasks.suggestAssignments).toHaveBeenCalledOnce();
    const call = tasks.suggestAssignments.mock.calls[0]![2];
    const today = new Date().toISOString().slice(0, 10);
    expect(call.businessDate).toBe(today);
    expect(call.shiftCapacityMin).toBe(290); // default
  });
});
