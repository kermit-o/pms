import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, listReservations, type ListReservationsQuery } from '@/lib/api';
import { ReservationsFilters } from '@/components/ReservationsFilters';
import { ReservationsTable } from '@/components/ReservationsTable';
import { normalizeReservationsQuery } from '@/lib/reservations-query';

/**
 * Shell reutilizable para /reservations, /arrivals, /departures, /in-house.
 * El preset se mergea con los filtros de la URL; los filtros explícitos del
 * usuario ganan sobre el preset.
 */
export async function renderReservationsList({
  searchParams,
  title,
  basePath,
  preset,
  emptyMessage,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  title: string;
  basePath: string;
  preset: Partial<ListReservationsQuery>;
  emptyMessage?: string;
}) {
  const session = await auth();
  const userParams = normalizeReservationsQuery(searchParams);
  const effective: ListReservationsQuery = { ...preset, ...userParams };

  let items: Awaited<ReturnType<typeof listReservations>>['items'] = [];
  let error: string | null = null;
  try {
    const res = await listReservations(session?.accessToken, { ...effective, limit: 100 });
    items = res.items;
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
            Aubergine · Reservas
          </p>
          <h1 className="text-2xl font-semibold text-aubergine-700">{title}</h1>
          <p className="text-xs text-aubergine-700/60">
            {items.length} reservas
            {Object.keys(userParams).length > 0 && ' (filtradas)'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/reservations/new?step=1"
            className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-medium text-white hover:bg-aubergine-800"
          >
            Nueva reserva
          </Link>
          <Link
            href="/reservations/new?step=1&walkIn=1"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-200 hover:bg-aubergine-50"
          >
            Walk-in
          </Link>
        </div>
      </header>

      <ReservationsFilters basePath={basePath} current={effective} />

      {error && (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      <ReservationsTable items={items} emptyMessage={emptyMessage} />
    </main>
  );
}
