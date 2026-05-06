import { z } from 'zod';

export const MintPairingDto = z.object({
  targetUserId: z.string().uuid(),
  ttlSeconds: z.coerce.number().int().min(30).max(900).optional(),
});
export type MintPairingDto = z.infer<typeof MintPairingDto>;

export const RedeemPairingDto = z.object({
  tenantId: z.string().uuid(),
  code: z.string().regex(/^[A-Z0-9]{12}$/),
});
export type RedeemPairingDto = z.infer<typeof RedeemPairingDto>;
