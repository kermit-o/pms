import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getActivePropertyId } from '@/lib/active-property';
import {
  ApiError,
  closeBusinessDay,
  getBusinessDayState,
  listBusinessDays,
  reopenBusinessDay,
  type BusinessDayState,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; businessDate?: string };
}

export default async function BusinessDayPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId ?? (await getActivePropertyId()) ?? undefined;
  const businessDate = searchParams.businessDate ?? new Date().toISOString().slice(0, 10);

  let current: BusinessDayState | null = null;
  let history: BusinessDayState[] = [];
  let error: string | null = null;

  if (propertyId) {
    try {
      current = await getBusinessDayState(session?.accessToken, propertyId, businessDate);
      history = await listBusinessDays(session?.accessToken, propertyId);
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  async function close(formData: FormData) {
    'use server';
    const session = await auth();
    const propertyId = formData.get('propertyId')?.toString();
    const businessDate = formData.get('businessDate')?.toString();
    if (!propertyId || !businessDate) throw new Error('Faltan campos');
    await closeBusinessDay(session?.accessToken, propertyId, businessDate);
    revalidatePath(`/business-day?propertyId=${propertyId}&businessDate=${businessDate}`);
  }

  async function reopen(formData: FormData) {
    'use server';
    const session = await auth();
    const propertyId = formData.get('propertyId')?.toString();
    const businessDate = formData.get('businessDate')?.toString();
    const reason = formData.get('reason')?.toString().trim();
    if (!propertyId || !businessDate || !reason) {
      throw new Error('Faltan campos');
    }
    await reopenBusinessDay(session?.accessToken, propertyId, businessDate, reason);
    revalidatePath(`/business-day?propertyId=${propertyId}&businessDate=${businessDate}`);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Operación
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Cierre de día</h1>
        <p className="text-sm text-aubergine-700/70">
          Bloquea mutaciones FO/folio sobre días cerrados. Los reabrir requiere rol{' '}
          <code>tenant_admin</code> y un motivo en el audit log.
        </p>
      </header>

      <form
        action={`/business-day`}
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Property ID
          <input
            name="propertyId"
            type="text"
            defaultValue={propertyId ?? ''}
            placeholder="UUID"
            className="mt-1 block w-72 rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Fecha
          <input
            name="businessDate"
            type="date"
            defaultValue={businessDate}
            className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-600 px-3 py-2 text-sm font-medium text-white hover:bg-aubergine-700"
        >
          Consultar
        </button>
      </form>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {current && propertyId && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
            {current.businessDate}
          </h2>
          <p className="mt-2 text-2xl font-semibold text-aubergine-700">{current.status}</p>
          {current.closedAt && (
            <p className="text-xs text-aubergine-700/70">
              Cerrado {current.closedAt} por {current.closedByUserId}
            </p>
          )}
          {current.reopenedAt && (
            <p className="text-xs text-rose-700/80">
              Reabierto {current.reopenedAt} · motivo: {current.reopenedReason}
            </p>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {current.status === 'OPEN' && (
              <form action={close} className="space-y-2 rounded-xl bg-aubergine-50/40 p-4">
                <input type="hidden" name="propertyId" value={propertyId} />
                <input type="hidden" name="businessDate" value={current.businessDate} />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
                  Cerrar día
                </h3>
                <p className="text-xs text-aubergine-700/70">
                  Bloqueará nuevas mutaciones de reservas/folio sobre esta fecha. Acción auditada.
                </p>
                <button
                  type="submit"
                  className="rounded-lg bg-aubergine-700 px-3 py-2 text-sm font-medium text-white hover:bg-aubergine-900"
                >
                  Cerrar {current.businessDate}
                </button>
              </form>
            )}

            {current.status === 'CLOSED' && (
              <form action={reopen} className="space-y-2 rounded-xl bg-rose-50 p-4">
                <input type="hidden" name="propertyId" value={propertyId} />
                <input type="hidden" name="businessDate" value={current.businessDate} />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Reabrir (admin)
                </h3>
                <input
                  name="reason"
                  type="text"
                  required
                  placeholder="motivo (e.g. corrección tardía)"
                  className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm focus:border-rose-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
                >
                  Reabrir
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {history.length > 0 && (() => {
        const open = history.filter((d) => d.status === 'OPEN');
        const lastClosed = history
          .filter((d) => d.status === 'CLOSED' && d.closedAt)
          .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];

        return (
          <section className="space-y-4">
            {lastClosed && (
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
                  Último cierre
                </p>
                <p className="mt-1 text-base font-medium text-aubergine-700">
                  {lastClosed.businessDate} · {relativeTime(lastClosed.closedAt!)}
                </p>
              </div>
            )}

            {open.length > 0 && (
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
                <header className="bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Días abiertos pendientes ({open.length})
                </header>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-aubergine-500">
                    <tr>
                      <th className="px-4 py-2">Fecha</th>
                      <th className="px-4 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-aubergine-100/70">
                    {open.map((d) => (
                      <tr key={d.businessDate}>
                        <td className="px-4 py-2">{d.businessDate}</td>
                        <td className="px-4 py-2">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            open
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })()}
    </main>
  );
}

function relativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  if (diffMs < 0) return 'en el futuro';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'hace unos segundos';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}
