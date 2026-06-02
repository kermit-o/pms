import { CityTaxRegion, TaxCategory } from '@pms/db';
import { z } from 'zod';

/**
 * RFC-001 §3.2 — AddChargeDto soporta dos modos cuando hay desglose:
 *   Modo bruto: { amount, taxCategory, taxRate? }
 *   Modo neto : { netAmount, taxRate, taxCategory }
 * taxRate viaja como porcentaje [0, 100]. Si se omite en modo bruto,
 * el servicio lo resuelve desde PropertyTaxConfig.
 * En modo legacy (flag FOLIO_TAX_BREAKDOWN_ENABLED=false) se acepta
 * sólo { amount } sin taxCategory — manteniendo compatibilidad con
 * tenants existentes.
 */
export const AddChargeDto = z
  .object({
    description: z.string().min(1).max(500),
    amount: z.number().positive().optional(),
    netAmount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    taxCategory: z.nativeEnum(TaxCategory).optional(),
    type: z.enum(['CHARGE', 'TAX', 'ADJUSTMENT']).default('CHARGE'),
    idempotencyKey: z.string().min(1).max(120).optional(),
  })
  .refine(
    (d) => d.amount !== undefined || d.netAmount !== undefined,
    'amount o netAmount es obligatorio',
  )
  .refine(
    (d) => !(d.amount !== undefined && d.netAmount !== undefined),
    'no se puede dar amount y netAmount a la vez',
  )
  .refine(
    (d) => d.netAmount === undefined || d.taxRate !== undefined,
    'taxRate es obligatorio cuando se da netAmount',
  );

export type AddChargeDto = z.infer<typeof AddChargeDto>;

const PaymentMethod = z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER']);

export const AddPaymentDto = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  paymentMethod: PaymentMethod,
  reference: z.string().max(120).optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
});

export type AddPaymentDto = z.infer<typeof AddPaymentDto>;

export const ReopenFolioDto = z.object({
  reason: z.string().min(1).max(500),
});

export type ReopenFolioDto = z.infer<typeof ReopenFolioDto>;

/**
 * RFC-001 §3.2 — admin CRUD de la matriz PropertyTaxConfig.
 * Sólo se actualiza una categoría a la vez para mantener el histórico
 * limpio (cada PUT crea un row nuevo con effectiveFrom hoy).
 */
export const UpdatePropertyTaxConfigDto = z.object({
  taxRate: z.number().min(0).max(100),
});

export type UpdatePropertyTaxConfigDto = z.infer<typeof UpdatePropertyTaxConfigDto>;

/**
 * RFC-001 §3.3 — admin CRUD de la regla de city tax por property.
 * region es informativa; la lógica viene de amountPerNight + cap +
 * exenciones.
 */
export const UpsertCityTaxRuleDto = z.object({
  region: z.nativeEnum(CityTaxRegion),
  amountPerNight: z.number().min(0).max(99.99),
  appliesToAdults: z.boolean(),
  appliesToChildren: z.boolean(),
  childAgeThreshold: z.number().int().min(0).max(99),
  maxNights: z.number().int().min(0).max(99),
});

export type UpsertCityTaxRuleDto = z.infer<typeof UpsertCityTaxRuleDto>;

/**
 * RFC-001 §3.3 — override del city tax aplicado por el NA.
 * Exige motivo de >= 10 caracteres (decisión PO en PRD-001).
 */
export const CityTaxOverrideDto = z.object({
  newAmount: z.number().min(0).max(9999.99),
  reason: z.string().min(10).max(500),
});

export type CityTaxOverrideDto = z.infer<typeof CityTaxOverrideDto>;
