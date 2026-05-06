import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  ApiError,
  listSesSubmissions,
  queueSesSubmission,
  sendSesSubmission,
  type SesSubmission,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string };
}

export default async function SesPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;

  let submissions: SesSubmission[] = [];
  let error: string | null = null;
  if (propertyId) {
    try {
      submissions = await listSesSubmissions(session?.accessToken, {
        propertyId,
      });
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  async function queueAction(formData: FormData) {
    'use server';
    const session = await auth();
    const propertyId = formData.get('propertyId')?.toString();
    const businessDate = formData.get('businessDate')?.toString();
    if (!propertyId || !businessDate) throw new Error('Faltan campos');
    await queueSesSubmission(session?.accessToken, propertyId, businessDate);
    revalidatePath(`/compliance/ses?propertyId=${propertyId}`);
  }

  async function sendAction(formData: FormData) {
    'use server';
    const session = await auth();
    const id = formData.get('id')?.toString();
    const propertyId = formData.get('propertyId')?.toString();
    if (!id || !propertyId) throw new Error('Faltan campos');
    await sendSesSubmission(session?.accessToken, id);
    revalidatePath(`/compliance/ses?propertyId=${propertyId}`);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Compliance
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">SES.HOSPEDAJES</h1>
        <p className="text-sm text-aubergine-700/70">
          Partes diarios para la Guardia Civil (RD 933/2021). Reintentos exponenciales: 1m, 5m, 30m,
          4h, 24h. Tras 5 fallos → DEAD_LETTER + alerta al equipo.
        </p>
      </header>

      <form
        action="/compliance/ses"
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-aubergine-100"
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
        <button
          type="submit"
          className="rounded-lg bg-aubergine-600 px-3 py-2 text-sm font-medium text-white hover:bg-aubergine-700"
        >
          Cargar
        </button>
      </form>

      {propertyId && (
        <form
          action={queueAction}
          className="flex flex-wrap items-end gap-2 rounded-2xl bg-aubergine-50/40 p-4 ring-1 ring-aubergine-100"
        >
          <input type="hidden" name="propertyId" value={propertyId} />
          <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Generar parte para
            <input
              name="businessDate"
              type="date"
              required
              className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-aubergine-700 px-3 py-2 text-sm font-medium text-white hover:bg-aubergine-900"
          >
            Encolar parte
          </button>
        </form>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {propertyId && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
          <table className="w-full text-sm">
            <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Reintentos</th>
                <th className="px-4 py-2">Próximo</th>
                <th className="px-4 py-2">Último error</th>
                <th className="px-4 py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-aubergine-100/70">
              {submissions.length === 0 && !error && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-aubergine-700/60">
                    Sin envíos para este property.
                  </td>
                </tr>
              )}
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-mono">{s.businessDate}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-aubergine-700/70">{s.retryCount} / 5</td>
                  <td className="px-4 py-3 text-aubergine-700/70">
                    {s.nextAttemptAt ? s.nextAttemptAt.slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-rose-700/80 text-xs max-w-md truncate">
                    {s.lastError ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Link
                        href={`/compliance/ses/${s.id}`}
                        className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
                      >
                        Detalle
                      </Link>
                      {(s.status === 'QUEUED' || s.status === 'FAILED') && (
                        <form action={sendAction} className="inline">
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="propertyId" value={s.propertyId} />
                          <button
                            type="submit"
                            className="rounded-lg bg-aubergine-600 px-2 py-1 text-xs font-medium text-white hover:bg-aubergine-700"
                          >
                            Enviar
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

const STATUS_STYLES: Record<string, string> = {
  QUEUED: 'bg-amber-100 text-amber-800',
  SENT: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
  DEAD_LETTER: 'bg-slate-800 text-white',
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
