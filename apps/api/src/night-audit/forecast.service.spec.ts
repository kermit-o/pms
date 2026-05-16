import { describe, expect, it, vi } from 'vitest';
import { NightAuditReportType } from '@pms/db';
import { ForecastService } from './forecast.service';
import type { AuthUser } from '../auth';

const user: AuthUser = {
  sub: 'u',
  tenantId: 't',
  email: 'a@b.test',
  roles: ['night_auditor'],
};
const PROP = '11111111-1111-1111-1111-111111111111';

function snapshot(d: string, occupancyPct: number, adr = 100, revpar = 50) {
  return {
    businessDate: new Date(`${d}T00:00:00Z`),
    payload: { occupancyPct, adr: String(adr), revpar: String(revpar) },
  };
}

function buildService(historicalSnapshots: ReturnType<typeof snapshot>[]) {
  const findMany = vi.fn().mockResolvedValue(historicalSnapshots);
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        nightAuditSnapshot: { findMany },
        $queryRaw: vi.fn().mockResolvedValue([]),
      }),
    ),
  };
  return { service: new ForecastService(prisma as never), findMany };
}

describe('ForecastService', () => {
  it('refuses to forecast with <14 points', async () => {
    const { service } = buildService(
      Array.from({ length: 10 }, (_, i) =>
        snapshot(`2026-05-${(i + 1).toString().padStart(2, '0')}`, 0.5),
      ),
    );
    const out = await service.forecast(user, 'cid', {
      propertyId: PROP,
      horizon: 30,
      metric: 'occupancy',
    });
    expect(out.series).toEqual([]);
    expect(out.message).toMatch(/insuficiente/);
  });

  it('returns horizon points for occupancy with positive trend', async () => {
    // 30 dias subiendo de 0.50 con leve ruido — Holt deberia proyectar arriba
    // y producir bandas finitas (sigma > 0).
    const series = Array.from({ length: 30 }, (_, i) => {
      const noise = ((i * 7) % 5) * 0.002 - 0.004;
      return snapshot(
        `2026-04-${(i + 1).toString().padStart(2, '0')}`,
        0.5 + 0.01 * i + noise,
      );
    });
    const { service } = buildService(series);
    const out = await service.forecast(user, 'cid', {
      propertyId: PROP,
      horizon: 7,
      metric: 'occupancy',
    });
    expect(out.message).toBeNull();
    expect(out.series).toHaveLength(7);
    expect(out.series[0]!.predicted).toBeGreaterThan(0.78);
    expect(out.series[6]!.predicted).toBeGreaterThan(out.series[0]!.predicted);
    // Bandas amplian con el horizonte.
    expect(out.series[6]!.upper - out.series[6]!.lower).toBeGreaterThan(
      out.series[0]!.upper - out.series[0]!.lower,
    );
  });

  it('rmse and mape are finite for a clean linear series', async () => {
    const series = Array.from({ length: 30 }, (_, i) =>
      snapshot(`2026-04-${(i + 1).toString().padStart(2, '0')}`, 0.5 + 0.01 * i),
    );
    const { service } = buildService(series);
    const out = await service.forecast(user, 'cid', {
      propertyId: PROP,
      horizon: 30,
      metric: 'occupancy',
    });
    expect(out.rmse).not.toBeNull();
    expect(out.rmse!).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(out.mape!)).toBe(true);
  });

  it('reads adr from MANAGER snapshot payload', async () => {
    const series = Array.from({ length: 20 }, (_, i) =>
      snapshot(`2026-04-${(i + 1).toString().padStart(2, '0')}`, 0.5, 100 + i),
    );
    const { service, findMany } = buildService(series);
    const out = await service.forecast(user, 'cid', {
      propertyId: PROP,
      horizon: 7,
      metric: 'adr',
    });
    expect(out.series).toHaveLength(7);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          propertyId: PROP,
          reportType: NightAuditReportType.MANAGER,
        }),
      }),
    );
  });
});
