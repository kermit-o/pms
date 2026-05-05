import { z } from 'zod';

export const roomStatusChangedV1 = z.object({
  roomId: z.string().uuid(),
  propertyId: z.string().uuid(),
  number: z.string().min(1),
  previousStatus: z.string(),
  newStatus: z.string(),
  isOutOfOrder: z.boolean(),
  changedAt: z.string(),
});
export type RoomStatusChangedV1Payload = z.infer<typeof roomStatusChangedV1>;
