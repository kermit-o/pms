import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ApiError, getFiscalReport, type FiscalReport } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    propertyId?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function FiscalReportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.accessToken) redirect('/login?callbackUrl=/reports/fiscal');

  const propertyId = sp.propertyId ?? '';
  const today = new Date();
  const defaultFrom = isoDate(addDays(today, -30));
  const defaultTo = isoDate(today);
  const from = sp.from ?? defaultFrom;
  const to = sp.to ?? defaultTo;

  let report: FiscalReport | null = null;
  let errorMsg: string | null = null;
  if (propertyId) {
    try {
      report = await getFiscalReport(session.accessToken, propertyId, from, to);
    } catch (err) {
      if (err instanceof ApiError) {
        errorMsg =
          err.status === 404
            ? 'No encontramos esa property'
            : err.status === 400
              ? 'Parámetros inválidos (fechas o propertyId)'
              : 'Error consultando el reporte';
      } else {
        throw err;
      }
    }
  }

  async function reload(formData: FormData) {
    'use server';
    const propertyId = String(formData.get('propertyId') ?? '').trim();
    const from = String(formData.get('from') ?? defaultFrom);
    const to = String(formData.get('to') ?? defaultTo);
    const qs = new URLSearchParams({ propertyId, from, to }).toString();
    redirect(`/reports/fiscal?${qs}`);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Reporting</p>
        <h1 className="text-2xl font-semibold text-aubergine-700">
          Reporte fiscal (IVA + city tax)
        </h1>
        <p className="text-sm text-aubergine-700/70">
          IVA desglosado por día y por tipo + city tax. Pensado para el contable
          del hotel y para el cierre fiscal mensual (RFC-001).
        </p>
      </header>

      <form
        action={reload}
        className="grid gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100 sm:grid-cols-4"
      >
        <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500 sm:col-span-2">
          Property ID
          <input
            name="propertyId"
            defaultValue={propertyId}
            placeholder="uuid de la property"
            required
            className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 font-mono text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
          />
        </label>
        <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Desde
          <input
            type="date"
            name="from"
            defaultValue={from}
            required
            className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
          />
        </label>
        <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Hasta
          <input
            type="date"
            name="to"
            defaultValue={to}
            required
            className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
          />
        </label>
        <div className="sm:col-span-4">
          <button
            type="submit"
            className="rounded-xl bg-aubergine-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-aubergine-800"
          >
            Calcular reporte
          </button>
        </div>
      </form>

      {errorMsg && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
          {errorMsg}
        </div>
      )}

      {report && (
        <section className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card title="Base imponible" value={report.totals.netAmount} />
            <Card title="IVA repercutido" value={report.totals.taxAmount} />
            <Card title="City tax" value={report.totals.cityTaxAmount} />
            <Card title="Total cobrado" value={report.totals.totalAmount} accent />
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
              IVA por tipo (rango completo)
            </h2>
            {report.totals.taxByRate.length === 0 ? (
              <p className="mt-2 text-sm text-aubergine-700/60">Sin movimientos con IVA.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                {report.totals.taxByRate.map((r) => (
                  <li
                    key={r.taxRate}
                    className="rounded-lg bg-aubergine-50/60 px-3 py-2 text-sm text-aubergine-900"
                  >
                    <span className="font-medium">{trimDecimal(r.taxRate)}%</span> →{' '}
                    {r.taxAmount} EUR
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
              Detalle por día
            </h2>
            <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-aubergine-100">
              <table className="w-full text-sm">
                <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
                  <tr>
                    <th className="px-3 py-2">Día</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">City tax</th>
                    <th className="px-3 py-2 text-right">Legacy</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-aubergine-100/70">
                  {report.byDay.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-aubergine-700/60">
                        Sin movimientos en el rango.
                      </td>
                    </tr>
                  )}
                  {report.byDay.map((d) => (
                    <tr key={d.day}>
                      <td className="px-3 py-2 font-medium text-aubergine-900">{d.day}</td>
                      <td className="px-3 py-2 text-right">{d.netAmount}</td>
                      <td className="px-3 py-2 text-right">{d.taxAmount}</td>
                      <td className="px-3 py-2 text-right">{d.cityTaxAmount}</td>
                      <td className="px-3 py-2 text-right text-aubergine-700/60">
                        {d.legacyAmount === '0.00' ? '—' : d.legacyAmount}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{d.totalAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <p className="text-center">
        <Link href="/dashboard" className="text-xs text-aubergine-700/70 underline">
          ← Volver al dashboard
        </Link>
      </p>
    </main>
  );
}

function Card({ title, value, accent }: { title: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl p-4 shadow-sm ring-1 ${
        accent
          ? 'bg-aubergine-700 text-white ring-aubergine-800'
          : 'bg-white text-aubergine-900 ring-aubergine-100'
      }`}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-wide ${
          accent ? 'text-aubergine-50/70' : 'text-aubergine-500'
        }`}
      >
        {title}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function trimDecimal(v: string): string {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toString();
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
