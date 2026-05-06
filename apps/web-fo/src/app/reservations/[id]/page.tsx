import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  ApiError,
  addFolioCharge,
  addFolioPayment,
  apiFetch,
  closeFolio,
  getFolio,
} from '@/lib/api';
import type { FolioDetail } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface ReservationDetail {
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
    guest: { id: string; firstName: string; lastName: string; email: string | null };
  }>;
  folio: { id: string; status: string; balance: string; currency: string } | null;
}

export default async function ReservationDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();

  let detail: ReservationDetail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<ReservationDetail>(`/reservations/${params.id}`, {
      accessToken: session?.accessToken,
    });
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/reservations" className="text-sm text-aubergine-500 hover:underline">
          ← Volver a reservas
        </Link>
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      </main>
    );
  }
  if (!detail) return null;

  let folio: FolioDetail | null = null;
  let folioError: string | null = null;
  if (detail.folio) {
    try {
      folio = await getFolio(session?.accessToken, detail.folio.id);
    } catch (err) {
      folioError =
        err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  const primary = detail.guests.find((g) => g.isPrimary)?.guest;
  const reservationId = detail.id;

  async function addCharge(formData: FormData) {
    'use server';
    const session = await auth();
    if (!folio) throw new Error('No folio');
    const description = formData.get('description')?.toString().trim();
    const amount = Number(formData.get('amount') ?? '0');
    const type = (formData.get('type')?.toString() as 'CHARGE' | 'TAX') ?? 'CHARGE';
    if (!description || !amount) throw new Error('Faltan campos');
    await addFolioCharge(session?.accessToken, folio.id, {
      description,
      amount,
      type,
      idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    revalidatePath(`/reservations/${reservationId}`);
  }

  async function addPayment(formData: FormData) {
    'use server';
    const session = await auth();
    if (!folio) throw new Error('No folio');
    const description = formData.get('description')?.toString().trim();
    const amount = Number(formData.get('amount') ?? '0');
    const paymentMethod = formData.get('paymentMethod')?.toString() as
      | 'CASH'
      | 'CARD'
      | 'BANK_TRANSFER'
      | 'OTHER';
    const reference = formData.get('reference')?.toString().trim() || undefined;
    if (!description || !amount || !paymentMethod) {
      throw new Error('Faltan campos');
    }
    await addFolioPayment(session?.accessToken, folio.id, {
      description,
      amount,
      paymentMethod,
      reference,
      idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    revalidatePath(`/reservations/${reservationId}`);
  }

  async function settleFolio() {
    'use server';
    const session = await auth();
    if (!folio) throw new Error('No folio');
    await closeFolio(session?.accessToken, folio.id);
    revalidatePath(`/reservations/${reservationId}`);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <Link href="/reservations" className="text-sm text-aubergine-500 hover:underline">
        ← Volver a reservas
      </Link>

      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
            Aubergine · Reservas
          </p>
          <h1 className="font-mono text-3xl font-semibold text-aubergine-700">{detail.code}</h1>
          <p className="text-sm text-aubergine-700/70">
            {detail.status.toLowerCase().replace('_', ' ')} · {detail.arrivalDate} →{' '}
            {detail.departureDate}
          </p>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Estancia">
          <Item label="Adultos" value={detail.adults} />
          <Item label="Niños" value={detail.children} />
          <Item label="Total reserva" value={`${detail.totalAmount} ${detail.currency}`} />
          {detail.notes && <Item label="Notas" value={detail.notes} />}
        </Section>

        {primary && (
          <Section title="Huésped principal">
            <Item label="Nombre" value={`${primary.firstName} ${primary.lastName}`} />
            <Item label="Email" value={primary.email ?? '—'} />
            <div className="col-span-2">
              <Link
                href={`/guests/${primary.id}`}
                className="text-xs font-medium text-aubergine-500 hover:underline"
              >
                Abrir cardex →
              </Link>
            </div>
          </Section>
        )}
      </div>

      {folioError && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {folioError}
        </div>
      )}

      {folio && (
        <FolioPanel
          folio={folio}
          addCharge={addCharge}
          addPayment={addPayment}
          settleFolio={settleFolio}
        />
      )}
    </main>
  );
}

function FolioPanel({
  folio,
  addCharge,
  addPayment,
  settleFolio,
}: {
  folio: FolioDetail;
  addCharge: (fd: FormData) => Promise<void>;
  addPayment: (fd: FormData) => Promise<void>;
  settleFolio: () => Promise<void>;
}) {
  const isOpen = folio.status === 'OPEN';
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
            Folio
          </h2>
          <p className="text-xs text-aubergine-700/60">{folio.id}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-aubergine-500">Balance</p>
          <p className="text-2xl font-semibold text-aubergine-700">
            {folio.balance} {folio.currency}
          </p>
          <p className="text-xs text-aubergine-700/60">Estado: {folio.status.toLowerCase()}</p>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl ring-1 ring-aubergine-100">
        <table className="w-full text-sm">
          <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2 text-right">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-aubergine-100/70">
            {folio.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-aubergine-700/60">
                  Sin movimientos.
                </td>
              </tr>
            )}
            {folio.entries.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 text-aubergine-700/80">
                  {e.postedAt.slice(0, 16).replace('T', ' ')}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      e.type === 'PAYMENT'
                        ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                        : 'rounded-full bg-aubergine-100 px-2 py-0.5 text-xs font-medium text-aubergine-700'
                    }
                  >
                    {e.type.toLowerCase()}
                  </span>
                </td>
                <td className="px-3 py-2">{e.description}</td>
                <td className="px-3 py-2 text-right font-medium">
                  {e.amount} {e.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <form action={addCharge} className="space-y-3 rounded-xl bg-aubergine-50/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
              Añadir cargo
            </h3>
            <FieldText name="description" label="Concepto" required />
            <FieldNumber name="amount" label="Importe" required step="0.01" />
            <Select name="type" label="Tipo" defaultValue="CHARGE">
              <option value="CHARGE">Cargo</option>
              <option value="TAX">IVA</option>
            </Select>
            <button
              type="submit"
              className="w-full rounded-lg bg-aubergine-600 py-2 text-sm font-medium text-white transition hover:bg-aubergine-700"
            >
              Añadir cargo
            </button>
          </form>

          <form action={addPayment} className="space-y-3 rounded-xl bg-emerald-50/50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Registrar pago
            </h3>
            <FieldText name="description" label="Concepto" required />
            <FieldNumber name="amount" label="Importe" required step="0.01" />
            <Select name="paymentMethod" label="Método">
              <option value="CARD">Tarjeta</option>
              <option value="CASH">Efectivo</option>
              <option value="BANK_TRANSFER">Transferencia</option>
              <option value="OTHER">Otro</option>
            </Select>
            <FieldText name="reference" label="Referencia" />
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Registrar pago
            </button>
          </form>
        </div>
      )}

      {isOpen && (
        <form action={settleFolio} className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={folio.balance !== '0'}
            className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-aubergine-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cerrar folio
          </button>
        </form>
      )}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">{title}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-aubergine-900">{children}</dl>
    </section>
  );
}

function Item({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-aubergine-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function FieldText({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-aubergine-700">{label}</span>
      <input
        name={name}
        type="text"
        required={required}
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}

function FieldNumber({
  name,
  label,
  required,
  step,
}: {
  name: string;
  label: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-aubergine-700">{label}</span>
      <input
        name={name}
        type="number"
        step={step}
        min={0}
        required={required}
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}

function Select({
  name,
  label,
  defaultValue,
  children,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-aubergine-700">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      >
        {children}
      </select>
    </label>
  );
}
