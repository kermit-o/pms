import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const taskType = z.enum(['CHECKOUT_CLEAN', 'STAYOVER_CLEAN', 'INSPECTION', 'MAINTENANCE']);

export const CreateTaskDto = z.object({
  propertyId: z.string().uuid(),
  roomId: z.string().uuid(),
  businessDate: isoDate,
  taskType: taskType.default('CHECKOUT_CLEAN'),
  assignedToUserId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateTaskDto = z.infer<typeof CreateTaskDto>;

export const ListTasksQuery = z.object({
  propertyId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  taskType: taskType.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;

export const CompleteTaskDto = z.object({
  resultingRoomStatus: z
    .enum(['CLEAN', 'INSPECTED', 'DIRTY', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'])
    .optional(),
  notes: z.string().max(2000).optional(),
});
export type CompleteTaskDto = z.infer<typeof CompleteTaskDto>;

export const CancelTaskDto = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelTaskDto = z.infer<typeof CancelTaskDto>;
