import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const documentType = z.enum(['DNI', 'NIE', 'PASSPORT', 'EU_ID', 'OTHER']);

export const CreateGuestDto = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(160),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  dateOfBirth: isoDate.optional(),
  documentType: documentType.optional(),
  documentNumber: z.string().min(1).max(40).optional(),
  documentIssuingCountry: z.string().length(2).optional(),
  documentExpiryDate: isoDate.optional(),
  nationality: z.string().length(2).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  region: z.string().max(120).optional(),
  country: z.string().length(2).optional(),
  gdprConsent: z.boolean().default(false),
  marketingConsent: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

export type CreateGuestDto = z.infer<typeof CreateGuestDto>;

export const PatchGuestDto = CreateGuestDto.partial();
export type PatchGuestDto = z.infer<typeof PatchGuestDto>;

export const EraseGuestDto = z.object({
  reason: z.string().min(1).max(500),
  hard: z.boolean().default(false),
});

export type EraseGuestDto = z.infer<typeof EraseGuestDto>;

export const ListGuestsQuery = z.object({
  q: z.string().max(120).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListGuestsQuery = z.infer<typeof ListGuestsQuery>;
