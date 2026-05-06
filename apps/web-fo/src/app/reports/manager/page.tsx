import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, getManagerReport, type ManagerReport } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; businessDate?: string };
}

export default async function ManagerReportPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;
  const businessDate = searchParams.businessDate ?? new Date().toISOString().slice(0, 10);

  let report: ManagerReport | null = null;
  let error: string | null = null;
  if (propertyId) {
    try {
      report = await getManagerReport(session?.accessToken, propertyId, businessDate);
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <Link
        href={`/reports?propertyId=${propertyId ?? ''}&date=${businessDate}`}
        className="text-sm text-aubergine-500 hover:underline"
      >
        ← Volver
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Reportes
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">
          Manager Report · {businessDate}
        </h1>
      </header>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {report && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Ocupación" value={`${Math.round(report.occupancyPct * 1000) / 10}%`} />
            <Kpi label="In-house" value={report.inHouse} />
            <Kpi label="Llegadas" value={report.arrivals} />
            <Kpi label="Salidas" value={report.departures} />
            <Kpi label="Habitaciones" value={report.totalRooms} />
            <Kpi label="Cancelaciones" value={report.cancellationsToday} />
            <Kpi label="ADR" value={`${report.adr} EUR`} />
            <Kpi label="RevPAR" value={`${report.revpar} EUR`} />
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
              Cargos del día
            </h2>
            <p className="mt-2 text-aubergine-900">
              {report.charges.count} entradas · <strong>{report.charges.totalAmount} EUR</strong>
            </p>
          </section>

          <a
            href={`/api/reports/manager?propertyId=${propertyId}&businessDate=${businessDate}`}
            className="inline-block rounded-lg bg-white px-3 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            Descargar CSV
          </a>
        </>
      )}
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
      <p className="text-xs font-medium uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-aubergine-700">{value}</p>
    </article>
  );
}
