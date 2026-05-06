import { z } from 'zod';

const baseGuest = z.object({
  guestId: z.string().uuid(),
});

export const guestCreatedV1 = baseGuest.extend({
  documentHash: z.string().nullable(),
  hasEmail: z.boolean(),
  nationality: z.string().length(2).nullable(),
});
export type GuestCreatedV1Payload = z.infer<typeof guestCreatedV1>;

export const guestUpdatedV1 = baseGuest.extend({
  changes: z.record(z.string(), z.unknown()),
});
export type GuestUpdatedV1Payload = z.infer<typeof guestUpdatedV1>;

export const guestErasedV1 = baseGuest.extend({
  erasedAt: z.string(),
  reason: z.string().min(1),
  hard: z.boolean(),
});
export type GuestErasedV1Payload = z.infer<typeof guestErasedV1>;

export const guestMergedV1 = z.object({
  primaryGuestId: z.string().uuid(),
  mergedGuestIds: z.array(z.string().uuid()).min(1),
});
export type GuestMergedV1Payload = z.infer<typeof guestMergedV1>;
