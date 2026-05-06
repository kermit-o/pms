import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, listReservations } from '@/lib/api';
import type { ReservationListItem } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ReservationsPage() {
  const session = await auth();

  let items: ReservationListItem[] = [];
  let error: string | null = null;
  try {
    const res = await listReservations(session?.accessToken, { limit: 50 });
    items = res.items;
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
            Aubergine · Reservas
          </p>
          <h1 className="text-3xl font-semibold text-aubergine-700">Reservas</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/reservations/new"
            className="rounded-lg bg-aubergine-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-aubergine-700"
          >
            Nueva reserva
          </Link>
          <Link
            href="/reservations/new?walkIn=1"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 transition hover:bg-aubergine-50"
          >
            Walk-in
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
        <table className="w-full text-sm">
          <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Llegada</th>
              <th className="px-4 py-3">Salida</th>
              <th className="px-4 py-3">Pax</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-aubergine-100/70">
            {items.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-aubergine-700/60">
                  Sin reservas todavía. Crea la primera con &quot;Nueva reserva&quot;.
                </td>
              </tr>
            )}
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-aubergine-50/50">
                <td className="px-4 py-3 font-mono text-aubergine-700">
                  <Link href={`/reservations/${r.id}`}>{r.code}</Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">{r.arrivalDate}</td>
                <td className="px-4 py-3">{r.departureDate}</td>
                <td className="px-4 py-3">
                  {r.adults}A {r.children > 0 ? `+ ${r.children}N` : ''}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {r.totalAmount} {r.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  CHECKED_IN: 'bg-emerald-100 text-emerald-800',
  CHECKED_OUT: 'bg-slate-100 text-slate-700',
  CANCELLED: 'bg-rose-100 text-rose-800',
  NO_SHOW: 'bg-orange-100 text-orange-800',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {status.toLowerCase().replace('_', ' ')}
    </span>
  );
}
