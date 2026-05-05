import { z } from 'zod';

export const propertyCreatedV1 = z.object({
  propertyId: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string(),
  currency: z.string().length(3),
});

export type PropertyCreatedV1Payload = z.infer<typeof propertyCreatedV1>;

export const propertyUpdatedV1 = z.object({
  propertyId: z.string().uuid(),
  changes: z.record(z.string(), z.unknown()),
});

export type PropertyUpdatedV1Payload = z.infer<typeof propertyUpdatedV1>;
