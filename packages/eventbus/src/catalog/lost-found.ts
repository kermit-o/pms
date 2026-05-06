import { z } from 'zod';

const base = z.object({
  itemId: z.string().uuid(),
  propertyId: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
});

export const lostFoundItemRegisteredV1 = base.extend({
  foundByUserId: z.string().uuid(),
  foundAt: z.string(),
  hasPhoto: z.boolean(),
});
export type LostFoundItemRegisteredV1Payload = z.infer<typeof lostFoundItemRegisteredV1>;

export const lostFoundItemClaimedV1 = base.extend({
  claimedByGuestId: z.string().uuid().nullable(),
  claimedByUserId: z.string().uuid(),
  claimedAt: z.string(),
});
export type LostFoundItemClaimedV1Payload = z.infer<typeof lostFoundItemClaimedV1>;

export const lostFoundItemDisposedV1 = base.extend({
  disposedByUserId: z.string().uuid(),
  disposedAt: z.string(),
  reason: z.string().nullable(),
});
export type LostFoundItemDisposedV1Payload = z.infer<typeof lostFoundItemDisposedV1>;
