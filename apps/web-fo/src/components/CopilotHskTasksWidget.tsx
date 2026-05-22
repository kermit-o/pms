import type { CopilotHskTasksWidget } from '@/lib/api';

/**
 * Sprint 13 — Pinta el resultado de hsk_list_today como una lista de
 * tareas con cabecera de conteos por status. Datos exactos del tool.
 */
export function CopilotHskTasksWidget({ widget }: { widget: CopilotHskTasksWidget }) {
  const { businessDate, rows, counts } = widget.data;
  return (
    <section className="mt-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-aubergine-200">
      <header className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-aubergine-500">
        <span>Housekeeping · datos en vivo</span>
        <span className="font-mono normal-case">{businessDate}</span>
      </header>

      <div className="flex gap-1.5 text-[10px]">
        <Counter label="Pendientes" value={counts.PENDING} tone="amber" />
        <Counter label="En curso" value={counts.IN_PROGRESS} tone="blue" />
        <Counter label="Hechas" value={counts.DONE} tone="emerald" />
        {counts.BLOCKED > 0 && <Counter label="Bloq." value={counts.BLOCKED} tone="rose" />}
      </div>

      {rows.length === 0 ? (
        <p className="px-1 text-xs text-aubergine-700/60">Sin tareas para esta fecha.</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 8).map((t) => (
            <li
              key={t.id}
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs ring-1 ${
                t.status === 'DONE'
                  ? 'bg-emerald-50/40 text-aubergine-700/60 ring-emerald-100'
                  : t.status === 'IN_PROGRESS'
                    ? 'bg-blue-50 ring-blue-100 text-aubergine-900'
                    : t.status === 'BLOCKED'
                      ? 'bg-rose-50 ring-rose-100 text-aubergine-900'
                      : 'bg-aubergine-50 ring-aubergine-100 text-aubergine-900'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-aubergine-700 ring-1 ring-aubergine-100">
                  {t.roomNumber ? `${t.roomNumber}` : '—'}
                </span>
                <span className="truncate font-medium">{prettyType(t.taskType)}</span>
                {t.notes && (
                  <span className="truncate text-[10px] text-aubergine-700/50" title={t.notes}>
                    · {t.notes}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-right">
                {t.assigneeName && (
                  <span className="text-[10px] text-aubergine-700/70">{t.assigneeName}</span>
                )}
                <StatusChip status={t.status} durationMin={t.durationMin} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 8 && (
        <p className="px-1 text-[10px] text-aubergine-700/50">
          Mostrando 8 de {rows.length} tareas.
        </p>
      )}
    </section>
  );
}

function prettyType(t: string): string {
  switch (t) {
    case 'CHECKOUT_CLEAN':
      return 'Salida · limpieza';
    case 'STAYOVER_CLEAN':
      return 'Estancia · limpieza';
    case 'INSPECTION':
      return 'Inspección';
    case 'MAINTENANCE':
      return 'Mantenimiento';
    default:
      return t;
  }
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-900',
  IN_PROGRESS: 'bg-blue-100 text-blue-900',
  DONE: 'bg-emerald-100 text-emerald-900',
  BLOCKED: 'bg-rose-100 text-rose-900',
};

function StatusChip({ status, durationMin }: { status: string; durationMin: number | null }) {
  const cls = STATUS_STYLES[status] ?? 'bg-aubergine-50 text-aubergine-700';
  const label = status === 'DONE' && durationMin ? `DONE · ${durationMin}min` : status;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${cls}`}>{label}</span>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'blue' | 'emerald' | 'rose';
}) {
  const toneCls: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-900 ring-amber-100',
    blue: 'bg-blue-50 text-blue-900 ring-blue-100',
    emerald: 'bg-emerald-50 text-emerald-900 ring-emerald-100',
    rose: 'bg-rose-50 text-rose-900 ring-rose-100',
  };
  return (
    <span
      className={`flex flex-1 items-baseline justify-between rounded-md px-2 py-1 ring-1 ${toneCls[tone]}`}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </span>
  );
}
