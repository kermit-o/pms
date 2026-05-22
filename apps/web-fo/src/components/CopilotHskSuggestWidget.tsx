import type { CopilotHskSuggestWidget } from '@/lib/api';

/**
 * Sprint 13 — Pinta el resultado de hsk_suggest_assignments (planificación
 * sugerida de tareas HSK). Muestra: carga por camarera, asignaciones
 * sugeridas y tareas sin asignar (con razón). Datos exactos del tool.
 *
 * Es un widget read-only — el supervisor revisa la propuesta y luego
 * (en otra acción) decide aplicar las asignaciones individualmente.
 */
export function CopilotHskSuggestWidget({ widget }: { widget: CopilotHskSuggestWidget }) {
  const { businessDate, shiftCapacityMin, candidates, suggestions, unmatched } = widget.data;
  return (
    <section className="mt-2 space-y-3 rounded-xl bg-white p-3 ring-1 ring-aubergine-200">
      <header className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-aubergine-500">
        <span>Plan HSK · sugerido</span>
        <span className="font-mono normal-case">
          {businessDate} · turno {shiftCapacityMin} min
        </span>
      </header>

      {/* Carga por camarera */}
      {candidates.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-aubergine-500">
            Carga por camarera
          </p>
          <ul className="space-y-1">
            {candidates.map((c) => {
              const pct = Math.round((c.totalAssignedMin / shiftCapacityMin) * 100);
              const tone =
                pct >= 95 ? 'bg-rose-100 text-rose-900' : pct >= 75 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900';
              return (
                <li
                  key={c.userId}
                  className="flex items-center justify-between gap-2 rounded-md bg-aubergine-50 px-2 py-1 text-xs ring-1 ring-aubergine-100"
                >
                  <span className="font-medium text-aubergine-900">
                    {c.userName ?? c.userId.slice(0, 8)}
                  </span>
                  <span className="flex items-center gap-2 text-aubergine-700/70">
                    <span>
                      {c.taskCount} tareas · {c.totalAssignedMin} min
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${tone}`}>
                      {pct}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Asignaciones sugeridas */}
      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-aubergine-500">
            Asignaciones ({suggestions.length})
          </p>
          <ul className="space-y-1">
            {suggestions.slice(0, 10).map((s) => (
              <li
                key={s.taskId}
                className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1 text-xs ring-1 ring-aubergine-100"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-aubergine-50 px-1.5 py-0.5 font-mono text-[10px] text-aubergine-700">
                    {s.roomNumber}
                  </span>
                  <span className="text-aubergine-900">{prettyType(s.taskType)}</span>
                </div>
                <div className="flex items-center gap-2 text-right text-aubergine-700/70">
                  <span className="text-[10px]">{s.predictedMin} min</span>
                  <span className="font-medium text-aubergine-900">
                    → {s.suggestedUserName ?? s.suggestedUserId.slice(0, 8)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {suggestions.length > 10 && (
            <p className="px-1 text-[10px] text-aubergine-700/50">
              Mostrando 10 de {suggestions.length}.
            </p>
          )}
        </div>
      )}

      {/* Sin asignar */}
      {unmatched.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-rose-700">
            Sin asignar ({unmatched.length})
          </p>
          <ul className="space-y-1">
            {unmatched.map((u) => (
              <li
                key={u.taskId}
                className="flex items-center justify-between gap-2 rounded-md bg-rose-50 px-2 py-1 text-xs ring-1 ring-rose-100"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-aubergine-700">
                    {u.roomNumber}
                  </span>
                  <span className="text-aubergine-900">{prettyType(u.taskType)}</span>
                </div>
                <span className="text-[10px] text-rose-700">
                  {prettyReason(u.reason)} · {u.predictedMin} min
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidates.length === 0 && suggestions.length === 0 && unmatched.length === 0 && (
        <p className="px-1 text-xs text-aubergine-700/60">Sin tareas pendientes para sugerir.</p>
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

function prettyReason(r: string): string {
  switch (r) {
    case 'no_candidates':
      return 'sin camareras';
    case 'capacity_exhausted':
      return 'capacidad llena';
    default:
      return r;
  }
}
