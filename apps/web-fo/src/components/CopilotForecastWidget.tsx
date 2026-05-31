import type { CopilotForecastWidget } from '@/lib/api';

/**
 * Sprint 14 — Pinta el resultado de forecast_demand como tarjeta lateral
 * compacta: badge de fiabilidad (MAPE), 3 cifras clave (próximo día, último
 * día, media del horizonte) y un sparkline SVG con la cola del histórico
 * pegada al horizonte. Datos exactos del tool.
 *
 * Cuando el service del forecast no pudo calcular (serie histórica < 14
 * puntos), el widget enseña sólo el mensaje del backend y oculta cifras.
 */
export function CopilotForecastWidget({ widget }: { widget: CopilotForecastWidget }) {
  const { metric, horizon, message, mape, summary, sparkline } = widget.data;
  const isOk = !message && summary.nextDay !== null;

  return (
    <section className="mt-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-aubergine-200">
      <header className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-aubergine-500">
        <span className="flex items-center gap-1.5">
          Forecast · {METRIC_LABEL[metric]}
          <span className="rounded-full bg-aubergine-50 px-1.5 py-0.5 text-[10px] normal-case font-mono text-aubergine-700">
            {horizon}d
          </span>
        </span>
        {mape !== null && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold normal-case ${qualityClass(mape)}`}
            title={`Error medio absoluto del ajuste sobre el histórico (MAPE)`}
          >
            MAPE {mape.toFixed(1)}%
          </span>
        )}
      </header>

      {!isOk ? (
        <p className="px-1 text-xs text-aubergine-700/70">
          {message ?? 'Sin datos suficientes para pronosticar.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <ForecastFigure
              label="Próximo día"
              date={summary.nextDay!.date}
              value={summary.nextDay!.predicted}
              lower={summary.nextDay!.lower}
              upper={summary.nextDay!.upper}
              metric={metric}
            />
            <ForecastFigure
              label="Media horizonte"
              value={summary.avgPredicted ?? 0}
              metric={metric}
            />
            <ForecastFigure
              label="Último día"
              date={summary.lastDay!.date}
              value={summary.lastDay!.predicted}
              lower={summary.lastDay!.lower}
              upper={summary.lastDay!.upper}
              metric={metric}
            />
          </div>

          {sparkline.length > 1 && <Sparkline sparkline={sparkline} />}
        </>
      )}
    </section>
  );
}

const METRIC_LABEL: Record<CopilotForecastWidget['data']['metric'], string> = {
  occupancy: 'Ocupación',
  adr: 'ADR',
  revpar: 'RevPAR',
  pickup: 'Pickup',
};

function qualityClass(mape: number): string {
  if (mape < 5) return 'bg-emerald-100 text-emerald-900';
  if (mape < 15) return 'bg-amber-100 text-amber-900';
  return 'bg-rose-100 text-rose-900';
}

function ForecastFigure({
  label,
  value,
  lower,
  upper,
  date,
  metric,
}: {
  label: string;
  value: number;
  lower?: number;
  upper?: number;
  date?: string;
  metric: CopilotForecastWidget['data']['metric'];
}) {
  const isPct = metric === 'occupancy';
  const isCount = metric === 'pickup';
  const formatted = isPct
    ? `${(value * 100).toFixed(0)}%`
    : isCount
      ? value.toFixed(0)
      : value.toFixed(2);
  return (
    <div className="rounded-md bg-aubergine-50 px-1.5 py-1 ring-1 ring-aubergine-100">
      <p className="text-[9px] uppercase tracking-wide text-aubergine-700/60">{label}</p>
      <p className="font-mono text-sm font-semibold text-aubergine-900">{formatted}</p>
      {lower !== undefined && upper !== undefined && (
        <p className="text-[9px] text-aubergine-700/50" title={`Banda 95% del modelo Holt`}>
          ±
          {isPct
            ? Math.round(((upper - lower) / 2) * 100) + '%'
            : isCount
              ? Math.round((upper - lower) / 2).toString()
              : ((upper - lower) / 2).toFixed(2)}
        </p>
      )}
      {date && <p className="text-[9px] font-mono text-aubergine-700/40">{date.slice(5)}</p>}
    </div>
  );
}

/**
 * SVG sparkline: línea para histórico (sólida), línea para horizonte
 * (punteada), separador vertical entre las dos. Auto-escala a min/max
 * con padding 5%. Sin dependencias.
 */
function Sparkline({ sparkline }: { sparkline: CopilotForecastWidget['data']['sparkline'] }) {
  const W = 280;
  const H = 40;
  const PAD = 2;

  const values = sparkline.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const xStep = (W - PAD * 2) / Math.max(1, sparkline.length - 1);
  const project = (p: { value: number }, i: number): [number, number] => [
    PAD + i * xStep,
    H - PAD - ((p.value - min) / range) * (H - PAD * 2),
  ];

  const histPoints = sparkline
    .map((p, i) => (p.predicted ? null : project(p, i)))
    .filter((x): x is [number, number] => x !== null);
  const fcastPoints = sparkline
    .map((p, i) => (p.predicted ? project(p, i) : null))
    .filter((x): x is [number, number] => x !== null);

  // Para que la línea predicha enganche con el final del histórico, añadimos
  // el último punto histórico al principio del path predicho si existe.
  const lastHist = histPoints[histPoints.length - 1];
  const fcastPath = lastHist && fcastPoints.length > 0 ? [lastHist, ...fcastPoints] : fcastPoints;

  const histD = histPoints
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const fcastD = fcastPath
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  const splitX = lastHist ? lastHist[0] : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full" preserveAspectRatio="none">
      {splitX !== null && (
        <line
          x1={splitX}
          x2={splitX}
          y1={0}
          y2={H}
          stroke="currentColor"
          strokeOpacity={0.15}
          className="text-aubergine-700"
        />
      )}
      {histD && (
        <path
          d={histD}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-aubergine-700"
        />
      )}
      {fcastD && (
        <path
          d={fcastD}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="3 2"
          className="text-aubergine-500"
        />
      )}
    </svg>
  );
}
