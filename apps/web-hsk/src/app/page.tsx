import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { signOut } from '@/auth';
import { ApiError, listTasks, type Task } from '@/lib/api';
import { PAIRING_COOKIE, getApiToken } from '@/lib/server-token';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string };
}

export default async function HomePage({ searchParams }: PageProps) {
  const accessToken = await getApiToken();
  const propertyId = searchParams.propertyId;
  const today = new Date().toISOString().slice(0, 10);

  let tasks: Task[] = [];
  let error: string | null = null;
  if (propertyId) {
    try {
      tasks = await listTasks(accessToken, {
        propertyId,
        from: today,
        to: today,
      });
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
    }
  }

  const grouped = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.status;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }
  const order: Task['status'][] = ['IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
          <h1 className="text-2xl font-semibold text-aubergine-700">Housekeeping</h1>
          <p className="text-sm text-aubergine-700/70">{today}</p>
        </div>
        <form
          action={async () => {
            'use server';
            const jar = await cookies();
            const wasPaired = jar.has(PAIRING_COOKIE);
            jar.delete(PAIRING_COOKIE);
            if (wasPaired) {
              redirect('/login/qr');
            }
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            Salir
          </button>
        </form>
      </header>

      {!propertyId && (
        <form
          action="/"
          method="get"
          className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
        >
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Property ID
            <input
              name="propertyId"
              type="text"
              placeholder="UUID"
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base focus:border-aubergine-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-xl bg-aubergine-600 py-3 text-base font-medium text-white"
          >
            Cargar mis tareas
          </button>
        </form>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {propertyId && tasks.length === 0 && !error && (
        <p className="rounded-2xl bg-white p-8 text-center text-aubergine-700/60 ring-1 ring-aubergine-100">
          Sin tareas para hoy.
        </p>
      )}

      {order.map((status) => {
        const list = grouped.get(status);
        if (!list || list.length === 0) return null;
        return (
          <section key={status} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
              {status.toLowerCase().replace('_', ' ')} · {list.length}
            </h2>
            <ul className="space-y-2">
              {list.map((t) => (
                <li
                  key={t.id}
                  className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-base font-semibold text-aubergine-700">
                        {t.roomId.slice(0, 8)}
                      </p>
                      <p className="text-xs text-aubergine-700/70">
                        {t.taskType.toLowerCase().replace('_', ' ')}
                        {t.durationMin ? ` · ${t.durationMin} min` : ''}
                      </p>
                    </div>
                    <a
                      href={`/task/${t.id}`}
                      className="rounded-lg bg-aubergine-700 px-3 py-2 text-sm font-medium text-white"
                    >
                      Abrir
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {propertyId && (
        <nav className="flex gap-2 pt-2 text-xs">
          <a
            href={`/lost-found?propertyId=${propertyId}`}
            className="flex-1 rounded-xl bg-white px-3 py-2 text-center font-medium text-aubergine-700 ring-1 ring-aubergine-100"
          >
            Lost &amp; Found
          </a>
          <a
            href={`/supervisor?propertyId=${propertyId}&date=${today}`}
            className="flex-1 rounded-xl bg-white px-3 py-2 text-center font-medium text-aubergine-700 ring-1 ring-aubergine-100"
          >
            Supervisor
          </a>
        </nav>
      )}

      <p className="pb-2 text-center text-[10px] text-aubergine-700/40">
        Sprint 4 W3 · Lost &amp; Found + supervisor.
      </p>
    </main>
  );
}
