import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  ApiError,
  cancelReservationGroup,
  getReservationGroup,
  patchReservationGroup,
  type ReservationGroupDetail,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ReservationGroupPage({ params }: { params: { id: string } }) {
  const session = await auth();

  let detail: ReservationGroupDetail | null = null;
  let error: string | null = null;
  try {
    detail = await getReservationGroup(session?.accessToken, params.id);
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  if (error || !detail) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/reservations" className="text-sm text-aubergine-500 hover:underline">
          ← Volver a reservas
        </Link>
        {error && (
          <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
            {error}
          </div>
        )}
      </main>
    );
  }

  const groupId = detail.id;

  async function patchGroup(formData: FormData) {
    'use server';
    const session = await auth();
    const input = {
      arrival: formData.get('arrival')?.toString() || undefined,
      departure: formData.get('departure')?.toString() || undefined,
      organizerName: formData.get('organizerName')?.toString() || undefined,
      organizerEmail: formData.get('organizerEmail')?.toString() || undefined,
      organizerPhone: formData.get('organizerPhone')?.toString() || undefined,
      notes: formData.get('notes')?.toString() || undefined,
    };
    // Quitar vacios para no enviar string vacios
    Object.keys(input).forEach((k) => {
      const v = (input as Record<string, string | undefined>)[k];
      if (v === '' || v === undefined) delete (input as Record<string, unknown>)[k];
    });
    await patchReservationGroup(session?.accessToken, groupId, input);
    revalidatePath(`/reservations/groups/${groupId}`);
  }

  async function cancelGroup(formData: FormData) {
    'use server';
    const session = await auth();
    const reason = formData.get('reason')?.toString().trim();
    if (!reason) throw new Error('Motivo requerido');
    await cancelReservationGroup(session?.accessToken, groupId, reason);
    revalidatePath(`/reservations/groups/${groupId}`);
  }

  const active = detail.reservations.filter(
    (r) => r.status !== 'CHECKED_OUT' && r.status !== 'CANCELLED' && r.status !== 'NO_SHOW',
  );
  const byType = new Map<string, number>();
  for (const r of active) {
    byType.set(r.roomTypeId, (byType.get(r.roomTypeId) ?? 0) + 1);
  }

  // Fechas comunes (si TODAS las reservas comparten)
  const arrivals = new Set(active.map((r) => r.arrivalDate));
  const departures = new Set(active.map((r) => r.departureDate));
  const commonArrival = arrivals.size === 1 ? [...arrivals][0] : null;
  const commonDeparture = departures.size === 1 ? [...departures][0] : null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <Link href="/reservations" className="text-sm text-aubergine-500 hover:underline">
        ← Volver a reservas
      </Link>

      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Grupo
        </p>
        <h1 className="font-mono text-2xl font-semibold text-aubergine-700">{detail.code}</h1>
        <p className="text-base text-aubergine-700/80">{detail.name}</p>
        <p className="mt-1 text-sm text-aubergine-700/60">
          {active.length} reservas activas ·{' '}
          {Array.from(byType.entries())
            .map(([rt, n]) => `${n}×${rt.slice(0, 8)}`)
            .join(' · ')}
          {commonArrival && commonDeparture && (
            <> · {commonArrival} → {commonDeparture}</>
          )}
        </p>
      </header>

      {/* Bulk edit del grupo */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
          Editar grupo
        </h2>
        <p className="mt-1 text-xs text-aubergine-700/70">
          Los cambios de fechas se propagan a todas las reservas activas (PENDING / CONFIRMED /
          CHECKED_IN). Las terminadas (CHECKED_OUT, CANCELLED) se ignoran.
        </p>
        <form action={patchGroup} className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field
            label="Llegada (todas)"
            name="arrival"
            type="date"
            defaultValue={commonArrival ?? ''}
          />
          <Field
            label="Salida (todas)"
            name="departure"
            type="date"
            defaultValue={commonDeparture ?? ''}
          />
          <Field
            label="Organizador"
            name="organizerName"
            defaultValue={detail.organizerName ?? ''}
          />
          <Field
            label="Email organizador"
            name="organizerEmail"
            type="email"
            defaultValue={detail.organizerEmail ?? ''}
          />
          <Field
            label="Teléfono organizador"
            name="organizerPhone"
            defaultValue={detail.organizerPhone ?? ''}
          />
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-aubergine-700">Notas</span>
            <textarea
              name="notes"
              rows={2}
              defaultValue={detail.notes ?? ''}
              className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
            />
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-aubergine-700 px-5 py-2 text-sm font-medium text-white"
            >
              Aplicar al grupo
            </button>
          </div>
        </form>
      </section>

      {/* Bulk cancel */}
      {active.length > 0 && (
        <section className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-rose-700">
            Cancelar grupo
          </h2>
          <p className="mt-1 text-xs text-rose-900/70">
            Cancela las {active.length} reservas activas. Las CHECKED_OUT no se tocan.
          </p>
          <form action={cancelGroup} className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex-1 text-xs">
              <span className="font-medium text-rose-700">Motivo</span>
              <input
                name="reason"
                placeholder="ej. cancelación de la agencia"
                required
                className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm focus:outline-none"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
            >
              Cancelar todas
            </button>
          </form>
        </section>
      )}

      {/* Tabla de líneas — cada una sigue siendo editable individualmente */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
        <header className="bg-aubergine-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-aubergine-500">
          Reservas del grupo · {detail.reservations.length}
        </header>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-aubergine-500">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Llegada</th>
              <th className="px-4 py-2">Salida</th>
              <th className="px-4 py-2">PAX</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-aubergine-100/70">
            {detail.reservations.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  <Link
                    href={`/reservations/${r.id}`}
                    className="font-mono text-xs text-aubergine-700 hover:underline"
                  >
                    {r.code}
                  </Link>
                </td>
                <td className="px-4 py-2 text-xs text-aubergine-700/70">
                  {r.status.toLowerCase()}
                </td>
                <td className="px-4 py-2 text-xs">{r.arrivalDate}</td>
                <td className="px-4 py-2 text-xs">{r.departureDate}</td>
                <td className="px-4 py-2 text-xs">
                  {r.adults}A{r.children > 0 ? `+${r.children}N` : ''}
                </td>
                <td className="px-4 py-2 text-right text-xs">
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

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-aubergine-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
      />
    </label>
  );
}
