import { z } from 'zod';

// ~5 MB base64 — enough for a reasonable JPEG capture, not so large that it
// crashes Postgres or our payload limit. Frontend should compress to ~500 kB.
const MAX_PHOTO_LENGTH = 5_000_000;

export const RegisterLostFoundDto = z.object({
  propertyId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  photoBase64: z
    .string()
    .max(MAX_PHOTO_LENGTH)
    .refine((s) => s.startsWith('data:image/'), 'photoBase64 must be a data URL (data:image/...)')
    .optional(),
  notes: z.string().max(2000).optional(),
});
export type RegisterLostFoundDto = z.infer<typeof RegisterLostFoundDto>;

export const ListLostFoundQuery = z.object({
  propertyId: z.string().uuid().optional(),
  status: z.enum(['FOUND', 'CLAIMED', 'DISPOSED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListLostFoundQuery = z.infer<typeof ListLostFoundQuery>;

export const ClaimLostFoundDto = z.object({
  guestId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});
export type ClaimLostFoundDto = z.infer<typeof ClaimLostFoundDto>;

export const DisposeLostFoundDto = z.object({
  reason: z.string().min(1).max(500),
});
export type DisposeLostFoundDto = z.infer<typeof DisposeLostFoundDto>;
