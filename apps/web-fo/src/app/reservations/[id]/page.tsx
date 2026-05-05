import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Detail {
  id: string;
  code: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  totalAmount: string;
  currency: string;
  notes: string | null;
  guests: Array<{
    isPrimary: boolean;
    guest: { firstName: string; lastName: string; email: string | null };
  }>;
  folio: { id: string; status: string; balance: string; currency: string } | null;
}

export default async function ReservationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  let detail: Detail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<Detail>(`/reservations/${params.id}`, {
      accessToken: session?.accessToken,
    });
  } catch (err) {
    error =
      err instanceof ApiError
        ? `API ${err.status}: ${err.body}`
        : (err as Error).message;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/reservations"
          className="text-sm text-aubergine-500 hover:underline"
        >
          ← Volver a reservas
        </Link>
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      </main>
    );
  }
  if (!detail) return null;

  const primary = detail.guests.find((g) => g.isPrimary)?.guest;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <Link
        href="/reservations"
        className="text-sm text-aubergine-500 hover:underline"
      >
        ← Volver a reservas
      </Link>

      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Reservas
        </p>
        <h1 className="font-mono text-3xl font-semibold text-aubergine-700">
          {detail.code}
        </h1>
        <p className="text-sm text-aubergine-700/70">
          {detail.status.toLowerCase().replace('_', ' ')} ·{' '}
          {detail.arrivalDate} → {detail.departureDate}
        </p>
      </header>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
          Estancia
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-aubergine-900">
          <Item label="Adultos" value={detail.adults} />
          <Item label="Niños" value={detail.children} />
          <Item label="Total" value={`${detail.totalAmount} ${detail.currency}`} />
          {detail.notes && <Item label="Notas" value={detail.notes} />}
        </dl>
      </section>

      {primary && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
            Huésped principal
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-aubergine-900">
            <Item label="Nombre" value={`${primary.firstName} ${primary.lastName}`} />
            <Item label="Email" value={primary.email ?? '—'} />
          </dl>
        </section>
      )}

      {detail.folio && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
            Folio
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-aubergine-900">
            <Item label="Estado" value={detail.folio.status} />
            <Item
              label="Balance"
              value={`${detail.folio.balance} ${detail.folio.currency}`}
            />
          </dl>
          <p className="mt-3 text-xs text-aubergine-700/60">
            Cargos / pagos / splits llegan en S2-W3.
          </p>
        </section>
      )}
    </main>
  );
}

function Item({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-aubergine-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
