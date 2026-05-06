import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getTask } from '@/lib/api';
import { getApiToken } from '@/lib/server-token';
import { TaskActions } from './task-actions';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  CHECKOUT_CLEAN: 'Salida',
  STAYOVER_CLEAN: 'Hospedaje',
  INSPECTION: 'Inspección',
  MAINTENANCE: 'Mantenimiento',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

export default async function TaskDetailPage({ params }: { params: { id: string } }) {
  const accessToken = await getApiToken();

  let task;
  try {
    task = await getTask(accessToken, params.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Link
        href="/"
        className="inline-flex items-center text-sm text-aubergine-600 hover:underline"
      >
        ← Volver
      </Link>

      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
        <p className="text-xs uppercase tracking-[0.2em] text-aubergine-500">Habitación</p>
        <p className="font-mono text-3xl font-semibold text-aubergine-700">
          {task.roomId.slice(0, 8)}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-aubergine-500">Tipo</dt>
            <dd className="font-medium text-aubergine-700">
              {TYPE_LABEL[task.taskType] ?? task.taskType}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-aubergine-500">Estado</dt>
            <dd className="font-medium text-aubergine-700">
              {STATUS_LABEL[task.status] ?? task.status}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-aubergine-500">Fecha</dt>
            <dd className="font-medium text-aubergine-700">{task.businessDate.slice(0, 10)}</dd>
          </div>
          {task.durationMin != null && (
            <div>
              <dt className="text-xs text-aubergine-500">Duración</dt>
              <dd className="font-medium text-aubergine-700">{task.durationMin} min</dd>
            </div>
          )}
        </dl>
        {task.notes && (
          <p className="mt-3 rounded-lg bg-aubergine-50 p-3 text-sm text-aubergine-700">
            {task.notes}
          </p>
        )}
      </header>

      <TaskActions task={task} />
    </main>
  );
}
