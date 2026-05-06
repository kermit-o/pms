import { z } from 'zod';

const base = z.object({
  taskId: z.string().uuid(),
  propertyId: z.string().uuid(),
  roomId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const housekeepingTaskAssignedV1 = base.extend({
  taskType: z.string(),
  assignedToUserId: z.string().uuid().nullable(),
  assignedAt: z.string(),
});
export type HousekeepingTaskAssignedV1Payload = z.infer<typeof housekeepingTaskAssignedV1>;

export const housekeepingTaskStartedV1 = base.extend({
  startedByUserId: z.string().uuid(),
  startedAt: z.string(),
});
export type HousekeepingTaskStartedV1Payload = z.infer<typeof housekeepingTaskStartedV1>;

export const housekeepingTaskCompletedV1 = base.extend({
  completedByUserId: z.string().uuid(),
  completedAt: z.string(),
  durationMin: z.number().int().nonnegative(),
  resultingRoomStatus: z.string().nullable(),
});
export type HousekeepingTaskCompletedV1Payload = z.infer<typeof housekeepingTaskCompletedV1>;

export const housekeepingTaskCancelledV1 = base.extend({
  cancelledByUserId: z.string().uuid(),
  cancelledAt: z.string(),
  reason: z.string().nullable(),
});
export type HousekeepingTaskCancelledV1Payload = z.infer<typeof housekeepingTaskCancelledV1>;
