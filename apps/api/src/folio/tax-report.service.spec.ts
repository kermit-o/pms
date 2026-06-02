import { BadRequestException } from '@nestjs/common';
import { Prisma, TaxCategory } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { TaxReportService } from './tax-report.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'admin@hotel.test',
  roles: ['tenant_admin'],
};

interface RowOpts {
  amount: string;
  netAmount?: string | null;
  taxAmount?: string | null;
  taxRate?: string | null;
  taxCategory?: TaxCategory | null;
  day: string; // YYYY-MM-DD
}

function buildService(rows: RowOpts[]) {
  const tx = {
    folioEntry: {
      findMany: vi.fn().mockResolvedValue(
        rows.map((r) => ({
          amount: new Prisma.Decimal(r.amount),
          netAmount: r.netAmount ? new Prisma.Decimal(r.netAmount) : null,
          taxAmount: r.taxAmount ? new Prisma.Decimal(r.taxAmount) : null,
          taxRate: r.taxRate ? new Prisma.Decimal(r.taxRate) : null,
          taxCategory: r.taxCategory ?? null,
          postedAt: new Date(`${r.day}T12:00:00Z`),
        })),
      ),
    },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return new TaxReportService(prisma as never);
}

describe('TaxReportService.byDay', () => {
  it('agrega por día y por taxRate, separa CITY_TAX y legacy', async () => {
    const svc = buildService([
      // Día 2026-06-10 — 110€ habitación (10%) + 12.10€ parking (21%) + 4.80€ city tax.
      {
        day: '2026-06-10',
        amount: '110.00',
        netAmount: '100.00',
        taxAmount: '10.00',
        taxRate: '10.00',
        taxCategory: TaxCategory.ROOM,
      },
      {
        day: '2026-06-10',
        amount: '12.10',
        netAmount: '10.00',
        taxAmount: '2.10',
        taxRate: '21.00',
        taxCategory: TaxCategory.EXTRA_OTHER,
      },
      {
        day: '2026-06-10',
        amount: '4.80',
        netAmount: '4.80',
        taxAmount: '0.00',
        taxRate: '0.00',
        taxCategory: TaxCategory.CITY_TAX,
      },
      // Día 2026-06-11 — 50€ legacy charge sin breakdown.
      { day: '2026-06-11', amount: '50.00' },
    ]);
    const r = await svc.byDay(user, 'corr', PROPERTY_ID, '2026-06-10', '2026-06-11');
    expect(r.byDay).toHaveLength(2);
    const d10 = r.byDay.find((d) => d.day === '2026-06-10')!;
    expect(d10.netAmount).toBe('110.00');
    expect(d10.taxAmount).toBe('12.10');
    expect(d10.cityTaxAmount).toBe('4.80');
    expect(d10.totalAmount).toBe('126.90');
    expect(d10.taxByRate).toHaveLength(2);

    const d11 = r.byDay.find((d) => d.day === '2026-06-11')!;
    expect(d11.legacyAmount).toBe('50.00');
    expect(d11.netAmount).toBe('0.00');

    expect(r.totals.netAmount).toBe('110.00');
    expect(r.totals.taxAmount).toBe('12.10');
    expect(r.totals.cityTaxAmount).toBe('4.80');
    expect(r.totals.totalAmount).toBe('176.90');
  });

  it('rango vacío → totales 0', async () => {
    const svc = buildService([]);
    const r = await svc.byDay(user, 'corr', PROPERTY_ID, '2026-06-10', '2026-06-12');
    expect(r.byDay).toEqual([]);
    expect(r.totals.totalAmount).toBe('0.00');
  });

  it('rechaza formato de fecha inválido', async () => {
    const svc = buildService([]);
    await expect(
      svc.byDay(user, 'corr', PROPERTY_ID, '10-06-2026', '2026-06-11'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza to < from', async () => {
    const svc = buildService([]);
    await expect(
      svc.byDay(user, 'corr', PROPERTY_ID, '2026-06-11', '2026-06-10'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
