import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, listLostFound, type LostFoundItem } from '@/lib/api';
import { LostFoundForm } from './lost-found-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string };
}

const STATUS_LABEL: Record<string, string> = {
  FOUND: 'En custodia',
  CLAIMED: 'Entregado',
  DISPOSED: 'Descartado',
};

export default async function LostFoundPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;

  let items: LostFoundItem[] = [];
  let error: string | null = null;
  if (propertyId) {
    try {
      items = await listLostFound(session?.accessToken, { propertyId });
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Link
        href="/"
        className="inline-flex items-center text-sm text-aubergine-600 hover:underline"
      >
        ← Volver
      </Link>

      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
        <h1 className="text-2xl font-semibold text-aubergine-700">Lost &amp; Found</h1>
      </header>

      {!propertyId && (
        <form
          action="/lost-found"
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
            Cargar
          </button>
        </form>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {propertyId && <LostFoundForm propertyId={propertyId} />}

      {propertyId && items.length === 0 && !error && (
        <p className="rounded-2xl bg-white p-8 text-center text-aubergine-700/60 ring-1 ring-aubergine-100">
          Sin entradas todavía.
        </p>
      )}

      {items.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
            Recientes · {items.length}
          </h2>
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-aubergine-700">{it.description}</p>
                    <p className="mt-1 text-xs text-aubergine-700/60">
                      {new Date(it.foundAt).toLocaleString('es-ES', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      {it.roomId ? ` · hab ${it.roomId.slice(0, 8)}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full bg-aubergine-50 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-aubergine-700">
                    {STATUS_LABEL[it.status] ?? it.status}
                  </span>
                </div>
                {it.hasPhoto && (
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-aubergine-500">
                    📷 con foto
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
