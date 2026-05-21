import { Prisma } from '@pms/db';

/**
 * Sprint 13 W1 — Cómputo único de tarifa diaria a partir de:
 *
 *  1. RoomType.defaultRate (base inmutable).
 *  2. RatePlan.attributes.dailyRate si está presente (override fijo).
 *  3. RatePlan.discountPct (0-100) aplicado sobre el rate resultante.
 *
 * Orden: override-fijo > defaultRate, luego se aplica el descuento.
 * Esto reemplaza al `resolveDailyRateFromInputs` viejo, que sólo
 * soportaba (1) + (2). Mantenemos retro-compat: si no hay descuento ni
 * override fijo, el resultado es idéntico a defaultRate.
 */
export interface RatePlanPricingInput {
  attributes: Prisma.JsonValue | null;
  discountPct: Prisma.Decimal | number | null;
}

export function resolveDailyRate(
  defaultRate: Prisma.Decimal | number | string,
  ratePlan: RatePlanPricingInput | null,
): Prisma.Decimal {
  let rate = new Prisma.Decimal(defaultRate);
  if (!ratePlan) return rate;

  // (2) override fijo en attributes.dailyRate
  if (
    ratePlan.attributes &&
    typeof ratePlan.attributes === 'object' &&
    !Array.isArray(ratePlan.attributes) &&
    'dailyRate' in ratePlan.attributes
  ) {
    const raw = (ratePlan.attributes as Record<string, unknown>).dailyRate;
    if (typeof raw === 'number' || typeof raw === 'string') {
      try {
        const parsed = new Prisma.Decimal(raw);
        if (parsed.isFinite()) {
          rate = parsed;
        }
      } catch {
        /* fall through si el JSON está corrupto */
      }
    }
  }

  // (3) descuento porcentual (Sprint 13 W1)
  if (ratePlan.discountPct !== null && ratePlan.discountPct !== undefined) {
    const pct = new Prisma.Decimal(ratePlan.discountPct as Prisma.Decimal | number);
    if (pct.gt(0) && pct.lte(100)) {
      const multiplier = new Prisma.Decimal(100).minus(pct).div(100);
      rate = rate.mul(multiplier);
    }
  }
  return rate;
}
