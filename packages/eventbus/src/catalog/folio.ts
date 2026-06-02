import { z } from 'zod';

const baseFolio = z.object({
  folioId: z.string().uuid(),
  reservationId: z.string().uuid(),
  propertyId: z.string().uuid(),
});

// RFC-001 §3.2 — campos fiscales opcionales (backwards compatible).
// Los consumers viejos los ignoran. Cuando FOLIO_TAX_BREAKDOWN_ENABLED
// está activo, viajan siempre.
const TAX_CATEGORY = z.enum([
  'ROOM',
  'BREAKFAST',
  'EXTRA_FOOD',
  'EXTRA_OTHER',
  'CITY_TAX',
  'EXEMPT',
]);

export const folioChargeAddedV1 = baseFolio.extend({
  entryId: z.string().uuid(),
  description: z.string().min(1),
  amount: z.string(),
  currency: z.string().length(3),
  type: z.enum(['CHARGE', 'TAX']),
  newBalance: z.string(),
  postedAt: z.string(),
  netAmount: z.string().optional(),
  taxAmount: z.string().optional(),
  taxRate: z.string().optional(),
  taxCategory: TAX_CATEGORY.nullable().optional(),
});
export type FolioChargeAddedV1Payload = z.infer<typeof folioChargeAddedV1>;

export const folioPaymentReceivedV1 = baseFolio.extend({
  entryId: z.string().uuid(),
  description: z.string().min(1),
  amount: z.string(),
  currency: z.string().length(3),
  paymentMethod: z.string(),
  reference: z.string().nullable(),
  newBalance: z.string(),
  postedAt: z.string(),
});
export type FolioPaymentReceivedV1Payload = z.infer<typeof folioPaymentReceivedV1>;

export const folioClosedV1 = baseFolio.extend({
  closedAt: z.string(),
  finalBalance: z.string(),
});
export type FolioClosedV1Payload = z.infer<typeof folioClosedV1>;

export const folioReopenedV1 = baseFolio.extend({
  reopenedAt: z.string(),
  reason: z.string().min(1),
});
export type FolioReopenedV1Payload = z.infer<typeof folioReopenedV1>;
