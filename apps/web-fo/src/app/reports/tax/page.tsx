import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, getTaxReport, type TaxReport } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; from?: string; to?: string };
}

export default async function TaxReportPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;
  const today = new Date().toISOString().slice(0, 10);
  const monthFirst = `${today.slice(0, 7)}-01`;
  const from = searchParams.from ?? monthFirst;
  const to = searchParams.to ?? today;

  let report: TaxReport | null = null;
  let error: string | null = null;
  if (propertyId) {
    try {
      report = await getTaxReport(session?.accessToken, propertyId, from, to);
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <Link
        href={`/reports?propertyId=${propertyId ?? ''}`}
        className="text-sm text-aubergine-500 hover:underline"
      >
        ← Volver
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Reportes
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">IVA / Tax</h1>
        <p className="text-sm text-aubergine-700/70">
          {from} → {to}
        </p>
      </header>

      <form
        action="/reports/tax"
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
      >
        <input type="hidden" name="propertyId" value={propertyId ?? ''} />
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Desde
          <input
            name="from"
            type="date"
            defaultValue={from}
            className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Hasta
          <input
            name="to"
            type="date"
            defaultValue={to}
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

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {report && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
          <table className="w-full text-sm">
            <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
              <tr>
                <th className="px-4 py-2">Concepto</th>
                <th className="px-4 py-2">Entradas</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-aubergine-100/70">
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-aubergine-700/60">
                    Sin TAX en el rango.
                  </td>
                </tr>
              )}
              {report.rows.map((r) => (
                <tr key={r.description}>
                  <td className="px-4 py-2">{r.description}</td>
                  <td className="px-4 py-2 text-aubergine-700/70">{r.count}</td>
                  <td className="px-4 py-2 text-right font-medium">{r.totalAmount} EUR</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-aubergine-50/50 text-sm font-semibold">
              <tr>
                <td className="px-4 py-2" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-2 text-right">{report.totalAmount} EUR</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </main>
  );
}
