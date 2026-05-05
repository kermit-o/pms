import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, listGuests } from '@/lib/api';
import type { GuestListItem } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { q?: string };
}

export default async function GuestsPage({ searchParams }: PageProps) {
  const session = await auth();
  const q = searchParams.q?.trim() || undefined;

  let items: GuestListItem[] = [];
  let error: string | null = null;
  try {
    const res = await listGuests(session?.accessToken, { q, limit: 100 });
    items = res.items;
  } catch (err) {
    error =
      err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
            Aubergine · Cardex
          </p>
          <h1 className="text-3xl font-semibold text-aubergine-700">Huéspedes</h1>
        </div>
        <form action="/guests" method="get" className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por nombre, email, documento…"
            className="w-72 rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
          />
          <button
            type="submit"
            className="rounded-lg bg-aubergine-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-aubergine-700"
          >
            Buscar
          </button>
        </form>
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
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Nacionalidad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-aubergine-100/70">
            {items.length === 0 && !error && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-12 text-center text-aubergine-700/60"
                >
                  Sin resultados.
                </td>
              </tr>
            )}
            {items.map((g) => (
              <tr key={g.id} className="hover:bg-aubergine-50/50">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/guests/${g.id}`}
                    className="text-aubergine-700 hover:underline"
                  >
                    {g.lastName}, {g.firstName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-aubergine-700/80">
                  {g.email ?? '—'}
                </td>
                <td className="px-4 py-3 text-aubergine-700/80">
                  {g.documentType ? (
                    <span className="font-mono text-xs">
                      {g.documentType} {g.documentNumber}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-aubergine-700/80">
                  {g.nationality ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
