import Link from 'next/link';
import { auth } from '@/auth';
import {
  ApiError,
  getArrivalsDeparturesReport,
  type ArrivalsDeparturesReport,
  type ArrivalsDeparturesRow,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; businessDate?: string };
}

export default async function ArrivalsDeparturesPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;
  const businessDate = searchParams.businessDate ?? new Date().toISOString().slice(0, 10);

  let report: ArrivalsDeparturesReport | null = null;
  let error: string | null = null;
  if (propertyId) {
    try {
      report = await getArrivalsDeparturesReport(session?.accessToken, propertyId, businessDate);
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  const csvHref = propertyId
    ? `/api/reports/arrivals-departures?propertyId=${propertyId}&businessDate=${businessDate}`
    : null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <Link
        href={`/reports?propertyId=${propertyId ?? ''}&date=${businessDate}`}
        className="text-sm text-aubergine-500 hover:underline"
      >
        ← Volver
      </Link>
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
            Aubergine · Reportes
          </p>
          <h1 className="text-3xl font-semibold text-aubergine-700">
            Llegadas y salidas · {businessDate}
          </h1>
        </div>
        {csvHref && (
          <a
            href={csvHref}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            Descargar CSV
          </a>
        )}
      </header>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {report && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ListSection title={`Llegadas (${report.arrivals.length})`} rows={report.arrivals} />
          <ListSection title={`Salidas (${report.departures.length})`} rows={report.departures} />
        </div>
      )}
    </main>
  );
}

function ListSection({ title, rows }: { title: string; rows: ArrivalsDeparturesRow[] }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
      <header className="bg-aubergine-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-aubergine-500">
        {title}
      </header>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-aubergine-500">
          <tr>
            <th className="px-4 py-2">Código</th>
            <th className="px-4 py-2">Huésped</th>
            <th className="px-4 py-2">Hab.</th>
            <th className="px-4 py-2">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-aubergine-100/70">
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-12 text-center text-aubergine-700/60">
                Sin entradas.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.reservationId}>
              <td className="px-4 py-2">
                <Link
                  href={`/reservations/${r.reservationId}`}
                  className="text-aubergine-700 hover:underline"
                >
                  {r.code}
                </Link>
              </td>
              <td className="px-4 py-2">{r.primaryGuest ?? '—'}</td>
              <td className="px-4 py-2 font-mono">{r.roomNumber ?? '—'}</td>
              <td className="px-4 py-2 text-xs">{r.status.toLowerCase().replace(/_/g, ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
