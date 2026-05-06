import { z } from 'zod';

export const CreateSessionDto = z.object({
  propertyId: z.string().uuid().optional(),
});
export type CreateSessionDto = z.infer<typeof CreateSessionDto>;

export const SendMessageDto = z.object({
  content: z.string().min(1).max(8000),
});
export type SendMessageDto = z.infer<typeof SendMessageDto>;

export const ConfirmToolDto = z.object({
  pendingToolId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});
export type ConfirmToolDto = z.infer<typeof ConfirmToolDto>;
