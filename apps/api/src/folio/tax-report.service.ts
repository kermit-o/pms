import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, TaxCategory } from '@pms/db';
import type { AuthUser } from '../auth';
import { PrismaService } from '../db';

/**
 * RFC-001 §3.2 — reporting fiscal por property y rango de fechas.
 *
 * Agrega `folio_entries` (sólo cargos, no payments) entre
 * `from` y `to`, agrupando por:
 *   - fecha (día UTC)
 *   - taxRate (sólo entries con desglose)
 *   - taxCategory (para separar CITY_TAX del resto)
 *
 * Devuelve dos vistas:
 *   - byDay: filas día-IVA con netAmount/taxAmount/cityTax/total.
 *   - totals: agregado del rango entero.
 *
 * Sólo accesible a roles administrativos (controller decora con
 * @Roles tenant_admin, night_auditor).
 */
@Injectable()
export class TaxReportService {
  private readonly log = new Logger(TaxReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async byDay(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    fromIsoDate: string,
    toIsoDate: string,
  ): Promise<TaxReport> {
    const from = parseIsoDate(fromIsoDate, 'from');
    const to = parseIsoDate(toIsoDate, 'to');
    if (to < from) {
      throw new BadRequestException('to must be >= from');
    }
    const ctx = {
      tenantId: user.tenantId,
      actorId: user.sub,
      correlationId,
    };
    const toExclusive = new Date(to.getTime() + 24 * 3600 * 1000);

    const rows = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.folioEntry.findMany({
        where: {
          folio: { reservation: { propertyId } },
          postedAt: { gte: from, lt: toExclusive },
          type: { not: 'PAYMENT' },
        },
        select: {
          amount: true,
          netAmount: true,
          taxAmount: true,
          taxRate: true,
          taxCategory: true,
          postedAt: true,
        },
      });
    });

    const byDayMap = new Map<string, DayBucket>();
    const totalByRate = new Map<string, Prisma.Decimal>();
    let totalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);
    let totalCityTax = new Prisma.Decimal(0);
    let totalGross = new Prisma.Decimal(0);

    for (const row of rows) {
      const day = row.postedAt.toISOString().slice(0, 10);
      const bucket = byDayMap.get(day) ?? emptyBucket(day);
      const amount = row.amount;

      if (row.taxCategory === TaxCategory.CITY_TAX) {
        bucket.cityTaxAmount = bucket.cityTaxAmount.add(amount);
        totalCityTax = totalCityTax.add(amount);
      } else if (row.netAmount && row.taxAmount && row.taxRate) {
        bucket.netAmount = bucket.netAmount.add(row.netAmount);
        bucket.taxAmount = bucket.taxAmount.add(row.taxAmount);
        const rateKey = row.taxRate.toFixed(2);
        bucket.taxByRate.set(
          rateKey,
          (bucket.taxByRate.get(rateKey) ?? new Prisma.Decimal(0)).add(row.taxAmount),
        );
        totalByRate.set(
          rateKey,
          (totalByRate.get(rateKey) ?? new Prisma.Decimal(0)).add(row.taxAmount),
        );
        totalNet = totalNet.add(row.netAmount);
        totalTax = totalTax.add(row.taxAmount);
      } else {
        // Legacy: sin desglose, entra como bruto sin IVA explícito.
        bucket.legacyAmount = bucket.legacyAmount.add(amount);
      }

      bucket.totalAmount = bucket.totalAmount.add(amount);
      totalGross = totalGross.add(amount);
      byDayMap.set(day, bucket);
    }

    const byDay = Array.from(byDayMap.values())
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((b) => ({
        day: b.day,
        netAmount: b.netAmount.toFixed(2),
        taxAmount: b.taxAmount.toFixed(2),
        cityTaxAmount: b.cityTaxAmount.toFixed(2),
        legacyAmount: b.legacyAmount.toFixed(2),
        totalAmount: b.totalAmount.toFixed(2),
        taxByRate: Array.from(b.taxByRate.entries())
          .sort((a, c) => Number(a[0]) - Number(c[0]))
          .map(([rate, tax]) => ({ taxRate: rate, taxAmount: tax.toFixed(2) })),
      }));

    return {
      propertyId,
      from: fromIsoDate,
      to: toIsoDate,
      byDay,
      totals: {
        netAmount: totalNet.toFixed(2),
        taxAmount: totalTax.toFixed(2),
        cityTaxAmount: totalCityTax.toFixed(2),
        totalAmount: totalGross.toFixed(2),
        taxByRate: Array.from(totalByRate.entries())
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([rate, tax]) => ({ taxRate: rate, taxAmount: tax.toFixed(2) })),
      },
    };
  }
}

interface DayBucket {
  day: string;
  netAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  cityTaxAmount: Prisma.Decimal;
  legacyAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  taxByRate: Map<string, Prisma.Decimal>;
}

function emptyBucket(day: string): DayBucket {
  return {
    day,
    netAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    cityTaxAmount: new Prisma.Decimal(0),
    legacyAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(0),
    taxByRate: new Map(),
  };
}

function parseIsoDate(s: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException(`${label} must be YYYY-MM-DD (got '${s}')`);
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${label} is not a valid date`);
  }
  return d;
}

export interface TaxReport {
  propertyId: string;
  from: string;
  to: string;
  byDay: TaxReportDay[];
  totals: TaxReportTotals;
}

export interface TaxReportDay {
  day: string;
  netAmount: string;
  taxAmount: string;
  cityTaxAmount: string;
  legacyAmount: string;
  totalAmount: string;
  taxByRate: { taxRate: string; taxAmount: string }[];
}

export interface TaxReportTotals {
  netAmount: string;
  taxAmount: string;
  cityTaxAmount: string;
  totalAmount: string;
  taxByRate: { taxRate: string; taxAmount: string }[];
}
