import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, getTaskSummary, listTasks, type Task, type TaskSummary } from '@/lib/api';
import { ReassignControl } from './reassign-control';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; date?: string };
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const TYPE_LABEL: Record<string, string> = {
  CHECKOUT_CLEAN: 'Salida',
  STAYOVER_CLEAN: 'Hospedaje',
  INSPECTION: 'Inspección',
  MAINTENANCE: 'Mantenimiento',
};

export default async function SupervisorPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;
  const date = searchParams.date ?? new Date().toISOString().slice(0, 10);

  let summary: TaskSummary | null = null;
  let tasks: Task[] = [];
  let error: string | null = null;
  if (propertyId) {
    try {
      [summary, tasks] = await Promise.all([
        getTaskSummary(session?.accessToken, { propertyId, businessDate: date }),
        listTasks(session?.accessToken, { propertyId, from: date, to: date }),
      ]);
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
          <h1 className="text-3xl font-semibold text-aubergine-700">Supervisor</h1>
          <p className="text-sm text-aubergine-700/70">Panel diario · {date}</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href="/supervisor/pair"
            className="rounded-lg bg-aubergine-700 px-3 py-1.5 font-medium text-white"
          >
            Emparejar dispositivo
          </Link>
          <Link href="/" className="text-aubergine-600 hover:underline">
            ← Vista móvil
          </Link>
        </div>
      </div>

      <form
        action="/supervisor"
        method="get"
        className="flex flex-wrap gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
      >
        <label className="flex-1 text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Property ID
          <input
            name="propertyId"
            defaultValue={propertyId ?? ''}
            placeholder="UUID"
            className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Fecha
          <input
            name="date"
            type="date"
            defaultValue={date}
            className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="self-end rounded-xl bg-aubergine-600 px-4 py-2 text-sm font-medium text-white"
        >
          Cargar
        </button>
      </form>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {summary && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Total" value={summary.total} />
          <Kpi label="En curso" value={summary.byStatus.IN_PROGRESS} accent="bg-amber-50" />
          <Kpi label="Completadas" value={summary.byStatus.COMPLETED} accent="bg-emerald-50" />
          <Kpi
            label="Duración media"
            value={summary.avgDurationMin != null ? `${summary.avgDurationMin} min` : '—'}
          />
        </section>
      )}

      {summary && summary.byAssignee.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
            Por camarera
          </h2>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.byAssignee.map((row) => {
              const label = row.userId ? row.userId.slice(0, 8) : 'Sin asignar';
              const pct = row.total === 0 ? 0 : Math.round((row.completed / row.total) * 100);
              return (
                <li key={row.userId ?? 'unassigned'} className="rounded-xl bg-aubergine-50 p-3">
                  <p className="font-mono text-sm font-medium text-aubergine-700">{label}</p>
                  <p className="text-xs text-aubergine-700/70">
                    {row.completed} / {row.total} · {pct}%
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
          <table className="w-full text-sm">
            <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
              <tr>
                <th className="px-4 py-2">Habitación</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Asignada</th>
                <th className="px-4 py-2">Duración</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t border-aubergine-100/60">
                  <td className="px-4 py-2 font-mono text-aubergine-700">{t.roomId.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-aubergine-700">
                    {TYPE_LABEL[t.taskType] ?? t.taskType}
                  </td>
                  <td className="px-4 py-2 text-aubergine-700">
                    {STATUS_LABEL[t.status] ?? t.status}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-aubergine-700/70">
                    {t.assignedToUserId ? t.assignedToUserId.slice(0, 8) : '—'}
                  </td>
                  <td className="px-4 py-2 text-aubergine-700/70">
                    {t.durationMin != null ? `${t.durationMin} min` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <ReassignControl task={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ring-1 ring-aubergine-100 ${accent ?? 'bg-white'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-aubergine-700">{value}</p>
    </div>
  );
}
