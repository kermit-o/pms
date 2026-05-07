'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignmentSuggestions } from '@/lib/api';

interface Props {
  suggestions: AssignmentSuggestions;
}

const TYPE_LABEL: Record<string, string> = {
  CHECKOUT_CLEAN: 'Salida',
  STAYOVER_CLEAN: 'Hospedaje',
  INSPECTION: 'Inspección',
  MAINTENANCE: 'Mantenimiento',
};

/**
 * Panel de sugerencias HSK V1 (Sprint 5 W5). El supervisor revisa la
 * propuesta del greedy y aplica con un click — esto ejecuta los reassign
 * uno a uno (mutating, ADR-020 nos pide confirmacion humana, que es la
 * accion del boton). Los fallos individuales no abortan el batch — al
 * final mostramos cuantos se aplicaron y cuales fallaron.
 */
export function SuggestionsPanel({ suggestions }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ applied: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function applyAll() {
    if (!confirm(`Aplicar ${suggestions.suggestions.length} sugerencias de asignación?`)) return;
    setBusy(true);
    setError(null);
    let applied = 0;
    let failed = 0;
    for (const s of suggestions.suggestions) {
      try {
        const res = await fetch(`/api/proxy/tasks/${s.taskId}/reassign`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assignedToUserId: s.suggestedUserId }),
          cache: 'no-store',
        });
        if (res.ok) applied += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setResult({ applied, failed });
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-aubergine-700">
            Sugerencias de asignación · {suggestions.suggestions.length}
          </h2>
          <p className="text-xs text-aubergine-700/70">
            Heurística greedy con mediana histórica. Capacidad por turno:{' '}
            {suggestions.shiftCapacityMin} min · default {suggestions.defaultDurationMin} min/tarea.
            {suggestions.unmatched.length > 0 && (
              <span className="ml-1 text-amber-700">
                {suggestions.unmatched.length} sin asignar.
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void applyAll()}
          className="rounded-xl bg-aubergine-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Aplicando…' : 'Aplicar todas'}
        </button>
      </header>

      {result && (
        <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">
          ✓ {result.applied} aplicadas
          {result.failed > 0 && <span className="text-red-700"> · {result.failed} fallidas</span>}
        </p>
      )}

      {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.candidates.map((c) => {
          const pct = Math.round(
            (c.totalAssignedMin / Math.max(suggestions.shiftCapacityMin, 1)) * 100,
          );
          return (
            <div key={c.userId} className="rounded-xl bg-aubergine-50 p-3">
              <p className="font-mono text-xs font-medium text-aubergine-700">
                {c.userId.slice(0, 8)}
              </p>
              <p className="text-xs text-aubergine-700/70">
                {c.taskCount} tareas · {c.totalAssignedMin} min ({pct}%)
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-aubergine-100">
                <div
                  className="h-full bg-aubergine-600"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-aubergine-100">
        <table className="w-full text-xs">
          <thead className="bg-aubergine-50 text-left uppercase tracking-wide text-aubergine-500">
            <tr>
              <th className="px-3 py-2">Habitación</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Asignar a</th>
              <th className="px-3 py-2">Predicho</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.suggestions.map((s) => (
              <tr key={s.taskId} className="border-t border-aubergine-100/60">
                <td className="px-3 py-2 font-mono text-aubergine-700">
                  {s.roomNumber}
                  {s.floor ? ` (P${s.floor})` : ''}
                </td>
                <td className="px-3 py-2">{TYPE_LABEL[s.taskType] ?? s.taskType}</td>
                <td className="px-3 py-2 font-mono text-aubergine-600">
                  {s.suggestedUserId.slice(0, 8)}
                </td>
                <td className="px-3 py-2">{s.predictedMin} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {suggestions.unmatched.length > 0 && (
        <details className="text-xs text-aubergine-700/70">
          <summary className="cursor-pointer">
            {suggestions.unmatched.length} tareas sin asignar
          </summary>
          <ul className="mt-2 space-y-1">
            {suggestions.unmatched.map((u) => (
              <li key={u.taskId} className="font-mono">
                · {u.roomNumber} {TYPE_LABEL[u.taskType] ?? u.taskType} ({u.predictedMin} min) —{' '}
                {u.reason === 'no_candidates' ? 'sin candidatas' : 'capacidad agotada'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
