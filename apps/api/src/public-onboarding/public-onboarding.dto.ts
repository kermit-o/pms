import { z } from 'zod';

export const StartOnboardingDto = z.object({
  email: z.string().email().max(160),
  locale: z.enum(['es', 'en']).default('es'),
});
export type StartOnboardingDto = z.infer<typeof StartOnboardingDto>;

export const VerifyOnboardingDto = z.object({
  token: z.string().min(20).max(2048),
});
export type VerifyOnboardingDto = z.infer<typeof VerifyOnboardingDto>;

/**
 * El wizard recoge lo mínimo viable para que el hotel pueda abrir sesión y
 * empezar a configurar. RoomTypes detallados, tarifas y políticas se ajustan
 * desde el back-office después.
 */
export const SetupOnboardingDto = z.object({
  token: z.string().min(20).max(2048),
  hotel: z.object({
    name: z.string().min(2).max(120),
    city: z.string().min(2).max(80),
    country: z.string().length(2).default('ES'),
    timezone: z.string().min(3).max(80).default('Europe/Madrid'),
    currency: z.string().length(3).default('EUR'),
    locale: z.enum(['es-ES', 'en-US']).default('es-ES'),
    roomsCount: z.number().int().min(1).max(500),
  }),
  admin: z.object({
    fullName: z.string().min(2).max(120),
  }),
  acceptTerms: z.literal(true),
});
export type SetupOnboardingDto = z.infer<typeof SetupOnboardingDto>;
