import { Injectable, Logger } from '@nestjs/common';
import { NightAuditReportType, Prisma } from '@pms/db';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';

/**
 * Forecasting V1 (Sprint 6 W4).
 *
 * Modelo: double exponential smoothing (Holt) sobre la serie historica del
 * MANAGER snapshot. Estacionalidad semanal queda como follow-up — los
 * resultados V1 son utiles a 30 dias y razonables a 60-90; el horizonte
 * tope son los 90 dias del plan.
 *
 * Implementacion sin dependencias externas — `simple-statistics` no aporta
 * Holt-Winters out-of-the-box y el algoritmo cabe en ~50 lineas.
 *
 * Metricas soportadas (todas se leen de NightAuditSnapshot[MANAGER]):
 *  - occupancy: occupancyPct  (0..1)
 *  - adr:       adr (string Decimal) -> number EUR
 *  - revpar:    revpar (string Decimal) -> number EUR
 *  - pickup:    reservations creadas EL DIA D con arrival = D (consulta directa)
 *
 * Calibracion:
 *  - Ventana de training: 365 dias si hay datos, fallback 90 si la
 *    propiedad es nueva.
 *  - Si la serie < 14 puntos: devolvemos error porque cualquier proyeccion
 *    seria ruido.
 */
@Injectable()
export class ForecastService {
  private readonly log = new Logger(ForecastService.name);

  constructor(private readonly prisma: PrismaService) {}

  async forecast(
    user: AuthUser,
    correlationId: string,
    input: ForecastInput,
  ): Promise<ForecastResult> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const trainingStart = new Date(today);
    trainingStart.setUTCDate(trainingStart.getUTCDate() - 365);

    const series = await this.prisma.withTenant(ctx, (tx) =>
      this.loadSeries(tx, input.propertyId, input.metric, trainingStart, today),
    );
    if (series.length < 14) {
      return {
        metric: input.metric,
        horizon: input.horizon,
        modelFit: { alpha: 0, beta: 0 },
        rmse: null,
        mape: null,
        series: [],
        history: series,
        message: `serie insuficiente (${series.length} puntos < 14). Acumula al menos dos semanas de NA cerrado antes de pronosticar.`,
      };
    }
    const values = series.map((p) => p.value);
    const fit = holtFit(values);
    const future = holtForecast(values, fit, input.horizon);
    const residuals = holtInSampleResiduals(values, fit);
    const sigma = stddev(residuals);
    const out: ForecastPoint[] = future.map((predicted, i) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() + i + 1);
      // Banda 95% normal: predicted ± 1.96 * sigma * sqrt(h)
      const h = i + 1;
      const margin = 1.96 * sigma * Math.sqrt(h);
      return {
        date: date.toISOString().slice(0, 10),
        predicted: round2(predicted),
        lower: round2(Math.max(0, predicted - margin)),
        upper: round2(predicted + margin),
      };
    });
    return {
      metric: input.metric,
      horizon: input.horizon,
      modelFit: { alpha: fit.alpha, beta: fit.beta },
      rmse: round2(Math.sqrt(meanSquared(residuals))),
      mape: round2(meanAbsPercent(values, residuals) * 100),
      series: out,
      history: series,
      message: null,
    };
  }

  private async loadSeries(
    tx: Prisma.TransactionClient,
    propertyId: string,
    metric: ForecastMetric,
    from: Date,
    to: Date,
  ): Promise<Array<{ date: string; value: number }>> {
    if (metric === 'pickup') {
      // Pickup = reservas creadas el dia D cuya arrival = D. Consulta directa.
      const rows = await tx.$queryRaw<Array<{ d: string; cnt: number }>>`
        SELECT TO_CHAR(arrival_date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS cnt
        FROM reservations
        WHERE property_id = ${propertyId}::uuid
          AND arrival_date >= ${from}
          AND arrival_date <  ${to}
          AND DATE(created_at) = arrival_date
        GROUP BY d
        ORDER BY d
      `;
      return rows.map((r) => ({ date: r.d, value: Number(r.cnt) }));
    }
    const snapshots = await tx.nightAuditSnapshot.findMany({
      where: {
        propertyId,
        reportType: NightAuditReportType.MANAGER,
        businessDate: { gte: from, lt: to },
      },
      orderBy: { businessDate: 'asc' },
      select: { businessDate: true, payload: true },
    });
    return snapshots
      .map((s) => {
        const payload = s.payload as Record<string, unknown> | null;
        if (!payload) return null;
        let value: number;
        switch (metric) {
          case 'occupancy':
            value = Number(payload.occupancyPct);
            break;
          case 'adr':
            value = Number(payload.adr);
            break;
          case 'revpar':
            value = Number(payload.revpar);
            break;
          default:
            return null;
        }
        if (!Number.isFinite(value)) return null;
        return { date: s.businessDate.toISOString().slice(0, 10), value };
      })
      .filter((p): p is { date: string; value: number } => p !== null);
  }
}

// ---------------------------------------------------------------------------
// Holt (double exponential smoothing) — sin dependencias externas.
// ---------------------------------------------------------------------------

interface HoltFit {
  alpha: number;
  beta: number;
  lastLevel: number;
  lastTrend: number;
}

/**
 * Grid search ligero sobre alpha/beta minimizando SSE in-sample.
 * Granularidad 0.1 cubre los casos practicos sin coste real.
 */
function holtFit(series: number[]): HoltFit {
  let best: HoltFit | null = null;
  let bestSse = Infinity;
  for (let a = 0.1; a <= 0.9 + 1e-9; a += 0.1) {
    for (let b = 0.05; b <= 0.5 + 1e-9; b += 0.05) {
      const { sse, lastLevel, lastTrend } = holtRun(series, a, b);
      if (sse < bestSse) {
        bestSse = sse;
        best = { alpha: round2(a), beta: round2(b), lastLevel, lastTrend };
      }
    }
  }
  if (!best) throw new Error('holtFit: no candidates');
  return best;
}

function holtRun(
  series: number[],
  alpha: number,
  beta: number,
): { sse: number; lastLevel: number; lastTrend: number } {
  let level = series[0]!;
  let trend = series.length > 1 ? series[1]! - series[0]! : 0;
  let sse = 0;
  for (let t = 1; t < series.length; t += 1) {
    const forecast = level + trend;
    const obs = series[t]!;
    const err = obs - forecast;
    sse += err * err;
    const newLevel = alpha * obs + (1 - alpha) * (level + trend);
    const newTrend = beta * (newLevel - level) + (1 - beta) * trend;
    level = newLevel;
    trend = newTrend;
  }
  return { sse, lastLevel: level, lastTrend: trend };
}

function holtForecast(_series: number[], fit: HoltFit, horizon: number): number[] {
  const out: number[] = [];
  for (let h = 1; h <= horizon; h += 1) {
    out.push(fit.lastLevel + h * fit.lastTrend);
  }
  return out;
}

function holtInSampleResiduals(series: number[], fit: HoltFit): number[] {
  const residuals: number[] = [];
  let level = series[0]!;
  let trend = series.length > 1 ? series[1]! - series[0]! : 0;
  for (let t = 1; t < series.length; t += 1) {
    const forecast = level + trend;
    const obs = series[t]!;
    residuals.push(obs - forecast);
    const newLevel = fit.alpha * obs + (1 - fit.alpha) * (level + trend);
    const newTrend = fit.beta * (newLevel - level) + (1 - fit.beta) * trend;
    level = newLevel;
    trend = newTrend;
  }
  return residuals;
}

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((acc, x) => acc + (x - mu) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}
function meanSquared(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((acc, x) => acc + x * x, 0) / xs.length;
}
function meanAbsPercent(obs: number[], residuals: number[]): number {
  // Skip-zero MAPE — evita divisiones por cero en metricas tipo pickup.
  let count = 0;
  let sum = 0;
  for (let i = 0; i < residuals.length; i += 1) {
    const o = obs[i + 1] ?? 0;
    if (o === 0) continue;
    sum += Math.abs(residuals[i]! / o);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ForecastMetric = 'occupancy' | 'adr' | 'revpar' | 'pickup';

export interface ForecastInput {
  propertyId: string;
  horizon: number;
  metric: ForecastMetric;
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  metric: ForecastMetric;
  horizon: number;
  modelFit: { alpha: number; beta: number };
  rmse: number | null;
  mape: number | null;
  series: ForecastPoint[];
  history: Array<{ date: string; value: number }>;
  message: string | null;
}
