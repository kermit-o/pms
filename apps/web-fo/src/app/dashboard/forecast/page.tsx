import { auth } from '@/auth';
import {
  ApiError,
  getForecast,
  type ForecastMetric,
  type ForecastResult,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: {
    propertyId?: string;
    horizon?: string;
    metric?: ForecastMetric;
  };
}

const METRIC_LABELS: Record<ForecastMetric, string> = {
  occupancy: 'Ocupación (%)',
  adr: 'ADR (EUR)',
  revpar: 'RevPAR (EUR)',
  pickup: 'Pickup (reservas)',
};

export default async function ForecastPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;
  const horizon = Number(searchParams.horizon ?? 30);
  const metric: ForecastMetric =
    (searchParams.metric as ForecastMetric) ?? 'occupancy';

  let result: ForecastResult | null = null;
  let error: string | null = null;

  if (propertyId) {
    try {
      result = await getForecast(session?.accessToken, {
        propertyId,
        horizon,
        metric,
      });
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-aubergine-700">Forecast</h1>
        <p className="text-sm text-aubergine-700/60">
          Proyección Holt sobre la historia del MANAGER snapshot. Bandas al 95%.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
        <label className="text-xs text-aubergine-700">
          Property
          <input
            type="text"
            name="propertyId"
            defaultValue={propertyId ?? ''}
            placeholder="UUID propiedad"
            className="block w-72 rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-aubergine-700">
          Métrica
          <select
            name="metric"
            defaultValue={metric}
            className="block rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
          >
            <option value="occupancy">Ocupación</option>
            <option value="adr">ADR</option>
            <option value="revpar">RevPAR</option>
            <option value="pickup">Pickup</option>
          </select>
        </label>
        <label className="text-xs text-aubergine-700">
          Horizonte (d)
          <select
            name="horizon"
            defaultValue={String(horizon)}
            className="block rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
          >
            <option value="7">7</option>
            <option value="14">14</option>
            <option value="30">30</option>
            <option value="60">60</option>
            <option value="90">90</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-700 px-3 py-1.5 text-sm font-medium text-white"
        >
          Calcular
        </button>
      </form>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {!result && !error && !propertyId && (
        <p className="rounded-lg bg-aubergine-50 px-4 py-6 text-sm text-aubergine-700 ring-1 ring-aubergine-100">
          Introduce una propiedad para ver su forecast.
        </p>
      )}

      {result && result.message && (
        <p className="rounded-lg bg-amber-50 px-4 py-6 text-sm text-amber-800 ring-1 ring-amber-200">
          {result.message}
        </p>
      )}

      {result && result.series.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Métrica" value={METRIC_LABELS[result.metric]} />
            <Stat label="Horizonte" value={`${result.horizon} días`} />
            <Stat label="RMSE" value={result.rmse !== null ? String(result.rmse) : '—'} />
            <Stat label="MAPE" value={result.mape !== null ? `${result.mape}%` : '—'} />
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
            <ForecastChart history={result.history} series={result.series} metric={result.metric} />
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
            <h2 className="text-sm font-semibold text-aubergine-700">Predicción</h2>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs uppercase text-aubergine-500">
                <tr>
                  <th className="py-1">Fecha</th>
                  <th className="py-1">Predicho</th>
                  <th className="py-1">Mín (95%)</th>
                  <th className="py-1">Máx (95%)</th>
                </tr>
              </thead>
              <tbody>
                {result.series.map((p) => (
                  <tr key={p.date} className="border-t border-aubergine-50">
                    <td className="py-1">{p.date}</td>
                    <td className="py-1">{p.predicted}</td>
                    <td className="py-1 text-aubergine-700/60">{p.lower}</td>
                    <td className="py-1 text-aubergine-700/60">{p.upper}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-aubergine-100">
      <p className="text-[10px] uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-aubergine-700">{value}</p>
    </div>
  );
}

interface ChartProps {
  history: Array<{ date: string; value: number }>;
  series: Array<{ date: string; predicted: number; lower: number; upper: number }>;
  metric: ForecastMetric;
}

function ForecastChart({ history, series, metric }: ChartProps) {
  const w = 800;
  const h = 280;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const all = [
    ...history.map((p) => p.value),
    ...series.flatMap((p) => [p.predicted, p.lower, p.upper]),
  ];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(0.0001, max - min);
  const xs = [...history, ...series];
  const xScale = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, xs.length - 1);
  const yScale = (v: number) =>
    pad.t + (h - pad.t - pad.b) * (1 - (v - min) / span);

  const historyPath = history
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.value)}`)
    .join(' ');
  const offset = history.length;
  const predPath = series
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xScale(offset + i)} ${yScale(p.predicted)}`,
    )
    .join(' ');
  const upperPath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(offset + i)} ${yScale(p.upper)}`)
    .join(' ');
  const bandPath = `${upperPath} L ${xScale(offset + series.length - 1)} ${yScale(
    series[series.length - 1]!.lower,
  )} ${series
    .slice()
    .reverse()
    .map((p, i) => `L ${xScale(offset + series.length - 1 - i)} ${yScale(p.lower)}`)
    .join(' ')} Z`;

  // Eje Y: 5 ticks regulares.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * span);
  const fmt = (v: number) =>
    metric === 'occupancy' ? `${Math.round(v * 100)}%` : Math.round(v).toString();

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Forecast ${metric}`}
      className="w-full"
    >
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="#eee2ee"
            strokeWidth={1}
          />
          <text x={4} y={yScale(t) + 4} fontSize="10" fill="#7a4f7a">
            {fmt(t)}
          </text>
        </g>
      ))}
      <path d={bandPath} fill="#a07ba0" opacity={0.18} />
      <path d={historyPath} fill="none" stroke="#4a2c4a" strokeWidth={1.5} />
      <path d={predPath} fill="none" stroke="#7a4f7a" strokeWidth={1.5} strokeDasharray="4 3" />
      <line
        x1={xScale(history.length - 1)}
        x2={xScale(history.length - 1)}
        y1={pad.t}
        y2={h - pad.b}
        stroke="#cab8ca"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <text x={xScale(history.length - 1) + 4} y={pad.t + 10} fontSize="10" fill="#7a4f7a">
        hoy
      </text>
    </svg>
  );
}
