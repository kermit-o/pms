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

export const ReassignTaskDto = z.object({
  assignedToUserId: z.string().uuid().nullable(),
});
export type ReassignTaskDto = z.infer<typeof ReassignTaskDto>;

export const SummaryQuery = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
});
export type SummaryQuery = z.infer<typeof SummaryQuery>;

const csvUuidArray = z
  .union([z.string(), z.array(z.string()).optional()])
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const arr = typeof v === 'string' ? v.split(',') : v;
    return arr.map((s) => s.trim()).filter(Boolean);
  })
  .pipe(z.array(z.string().uuid()).optional());

export const SuggestAssignmentsQuery = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
  candidateUserIds: csvUuidArray,
  shiftCapacityMin: z.coerce.number().int().min(60).max(720).default(290),
  lookbackDays: z.coerce.number().int().min(7).max(180).default(30),
});
export type SuggestAssignmentsQuery = z.infer<typeof SuggestAssignmentsQuery>;
