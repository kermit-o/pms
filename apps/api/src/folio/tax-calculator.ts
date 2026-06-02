/**
 * RFC-001 §3.3 — TaxCalculator puro.
 *
 * Tres funciones sin Prisma ni I/O:
 *   - breakdownFromGross  : del bruto extrae base + cuota.
 *   - breakdownFromNet    : del neto produce cuota + bruto.
 *   - computeCityTax      : aplica regla city tax a una estancia.
 *
 * Todo en Prisma.Decimal. Redondeo half-up a 2 decimales (norma fiscal
 * estándar España — Real Decreto 1496/2003 y posteriores). Inputs en
 * string|number|Decimal; outputs siempre Decimal.
 *
 * Invariante de los breakdowns: net.add(tax) === gross (tras redondeo).
 * En valores donde el redondeo introduciría 0.01 de diferencia,
 * absorbemos el residuo en `tax` para preservar gross exacto, porque
 * el folio.balance se calcula sobre gross y no puede divergir.
 */

import { Prisma } from '@pms/db';

const TWO_DP = 2;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

type DecimalLike = Prisma.Decimal | string | number;

function toDecimal(v: DecimalLike): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

function round2(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(TWO_DP, HALF_UP);
}

export interface TaxBreakdown {
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
  taxRate: Prisma.Decimal;
}

export interface BreakdownInput {
  taxRate: DecimalLike;
}

export interface BreakdownFromGrossInput extends BreakdownInput {
  gross: DecimalLike;
}

export interface BreakdownFromNetInput extends BreakdownInput {
  net: DecimalLike;
}

/**
 * Del bruto (lo que paga el cliente) extrae base imponible y cuota IVA.
 *   net   = round(gross / (1 + rate/100))
 *   tax   = gross - net   (preserva la suma exacta)
 */
export function breakdownFromGross(input: BreakdownFromGrossInput): TaxBreakdown {
  const grossRaw = toDecimal(input.gross);
  const rate = toDecimal(input.taxRate);
  if (grossRaw.isNegative()) {
    throw new Error(`breakdownFromGross: gross must be >= 0 (got ${grossRaw.toString()})`);
  }
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new Error(`breakdownFromGross: taxRate must be in [0, 100] (got ${rate.toString()})`);
  }
  const gross = round2(grossRaw);
  const divisor = new Prisma.Decimal(1).plus(rate.div(100));
  const net = round2(gross.div(divisor));
  const tax = gross.minus(net);
  return { net, tax, gross, taxRate: rate };
}

/**
 * Del neto (base imponible) calcula cuota y bruto.
 *   tax   = round(net * rate/100)
 *   gross = net + tax
 */
export function breakdownFromNet(input: BreakdownFromNetInput): TaxBreakdown {
  const netRaw = toDecimal(input.net);
  const rate = toDecimal(input.taxRate);
  if (netRaw.isNegative()) {
    throw new Error(`breakdownFromNet: net must be >= 0 (got ${netRaw.toString()})`);
  }
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new Error(`breakdownFromNet: taxRate must be in [0, 100] (got ${rate.toString()})`);
  }
  const net = round2(netRaw);
  const tax = round2(net.times(rate).div(100));
  const gross = round2(net.plus(tax));
  return { net, tax, gross, taxRate: rate };
}

export interface CityTaxRuleInput {
  amountPerNight: DecimalLike;
  appliesToAdults: boolean;
  appliesToChildren: boolean;
  childAgeThreshold: number;
  maxNights: number;
}

export interface CityTaxInput {
  rule: CityTaxRuleInput;
  adults: number;
  children: { age: number }[];
  nights: number;
}

export interface CityTaxResult {
  /** Importe diario aplicado (= amountPerNight × pax cobrable). */
  perNight: Prisma.Decimal;
  /** Noches efectivas tras aplicar maxNights cap. */
  effectiveNights: number;
  /** Pax cobrable (adultos + niños cobrables según regla). */
  chargeablePax: number;
  /** Total city tax: perNight × effectiveNights. */
  total: Prisma.Decimal;
}

/**
 * Calcula el city tax para una estancia.
 *
 * Regla:
 *   chargeablePax  = (adults si appliesToAdults) + (children con age >= threshold si appliesToChildren)
 *   effectiveNights = min(nights, maxNights)
 *   perNight       = amountPerNight × chargeablePax
 *   total          = perNight × effectiveNights
 *
 * `maxNights = 0` se trata como "sin cap" — protege regiones que no
 * imponen máximo (raro). `nights = 0` devuelve 0.
 */
export function computeCityTax(input: CityTaxInput): CityTaxResult {
  if (input.adults < 0) {
    throw new Error(`computeCityTax: adults must be >= 0 (got ${input.adults})`);
  }
  if (input.nights < 0) {
    throw new Error(`computeCityTax: nights must be >= 0 (got ${input.nights})`);
  }

  const adultsCount = input.rule.appliesToAdults ? input.adults : 0;
  const childrenCount = input.rule.appliesToChildren
    ? input.children.filter((c) => c.age >= input.rule.childAgeThreshold).length
    : 0;
  const chargeablePax = adultsCount + childrenCount;

  const effectiveNights =
    input.rule.maxNights > 0 ? Math.min(input.nights, input.rule.maxNights) : input.nights;

  const amount = toDecimal(input.rule.amountPerNight);
  if (amount.isNegative()) {
    throw new Error(
      `computeCityTax: amountPerNight must be >= 0 (got ${amount.toString()})`,
    );
  }

  const perNight = round2(amount.times(chargeablePax));
  const total = round2(perNight.times(effectiveNights));

  return { perNight, effectiveNights, chargeablePax, total };
}
