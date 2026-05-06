import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; date?: string };
}

export default function ReportsPage({ searchParams }: PageProps) {
  const propertyId = searchParams.propertyId ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const date = searchParams.date ?? today;
  const monthFirst = `${date.slice(0, 7)}-01`;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Reportes
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Reportes</h1>
        <p className="text-sm text-aubergine-700/70">
          Manager / Revenue / Tax aterrizan en W3. In-house y Arrivals/Departures completos llegan
          en W4.
        </p>
      </header>

      <form
        action="/reports"
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Property ID
          <input
            name="propertyId"
            type="text"
            defaultValue={propertyId}
            placeholder="UUID"
            className="mt-1 block w-72 rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Fecha
          <input
            name="date"
            type="date"
            defaultValue={date}
            className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-600 px-3 py-2 text-sm font-medium text-white hover:bg-aubergine-700"
        >
          Aplicar
        </button>
      </form>

      <section className="grid gap-3 sm:grid-cols-3">
        <ReportTile
          href={`/reports/manager?propertyId=${propertyId}&businessDate=${date}`}
          enabled={!!propertyId}
          title="Manager"
          subtitle="Ocupación, ADR, RevPAR"
        />
        <ReportTile
          href={`/reports/revenue?propertyId=${propertyId}&from=${monthFirst}&to=${date}`}
          enabled={!!propertyId}
          title="Revenue"
          subtitle="Ingresos por concepto"
        />
        <ReportTile
          href={`/reports/tax?propertyId=${propertyId}&from=${monthFirst}&to=${date}`}
          enabled={!!propertyId}
          title="Tax"
          subtitle="IVA recaudado"
        />
        <ReportTile
          href={`/reports/in-house?propertyId=${propertyId}&businessDate=${date}`}
          enabled={!!propertyId}
          title="In-house"
          subtitle="Detalle por habitación"
        />
        <ReportTile
          href={`/reports/arrivals-departures?propertyId=${propertyId}&businessDate=${date}`}
          enabled={!!propertyId}
          title="Arrivals / Departures"
          subtitle="Llegadas y salidas del día"
        />
      </section>

      {!propertyId && (
        <p className="text-xs text-aubergine-700/60">
          Introduce un Property ID para habilitar los reportes.
        </p>
      )}
    </main>
  );
}

function ReportTile({
  href,
  enabled,
  title,
  subtitle,
}: {
  href: string;
  enabled: boolean;
  title: string;
  subtitle: string;
}) {
  if (!enabled) return <DisabledTile title={title} subtitle={subtitle} />;
  return (
    <Link
      href={href}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100 transition hover:bg-aubergine-50"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-aubergine-500">{title}</p>
      <p className="mt-1 text-base font-medium text-aubergine-700">{subtitle}</p>
    </Link>
  );
}

function DisabledTile({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 opacity-60 shadow-sm ring-1 ring-aubergine-100">
      <p className="text-xs font-medium uppercase tracking-wide text-aubergine-500">{title}</p>
      <p className="mt-1 text-base font-medium text-aubergine-700">{subtitle}</p>
    </div>
  );
}
