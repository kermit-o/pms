import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ApiError, createReservation } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { walkIn?: string };
}

export default async function NewReservationPage({ searchParams }: PageProps) {
  const isWalkIn = searchParams.walkIn === '1';

  async function submit(formData: FormData) {
    'use server';
    const session = await auth();
    const accessToken = session?.accessToken;

    const propertyId = formData.get('propertyId')?.toString().trim();
    const roomTypeId = formData.get('roomTypeId')?.toString().trim();
    const arrival = formData.get('arrival')?.toString();
    const departure = formData.get('departure')?.toString();
    const firstName = formData.get('firstName')?.toString().trim();
    const lastName = formData.get('lastName')?.toString().trim();
    const email = formData.get('email')?.toString().trim() || undefined;
    const phone = formData.get('phone')?.toString().trim() || undefined;
    const adults = Number(formData.get('adults') ?? '2');
    const children = Number(formData.get('children') ?? '0');
    const notes = formData.get('notes')?.toString() || undefined;
    const walkIn = formData.get('walkIn') === 'on';

    if (!propertyId || !roomTypeId || !arrival || !departure || !firstName || !lastName) {
      throw new Error('Faltan campos obligatorios');
    }

    try {
      const created = await createReservation(accessToken, {
        propertyId,
        roomTypeId,
        arrival,
        departure,
        guestData: { firstName, lastName, email, phone },
        occupancy: { adults, children },
        notes,
        walkIn,
      });
      redirect(`/reservations/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        throw new Error(`API ${err.status}: ${err.body}`);
      }
      throw err;
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Reservas
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">
          {isWalkIn ? 'Walk-in' : 'Nueva reserva'}
        </h1>
        <p className="text-sm text-aubergine-700/70">
          {isWalkIn
            ? 'Huésped en mostrador. Tras crear, queda en CHECKED_IN.'
            : 'Captura básica. Cardex + tarifas detalladas en S2-W4.'}
        </p>
      </header>

      <form
        action={submit}
        className="space-y-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100"
      >
        <Section title="Estancia">
          <Field label="Property ID" name="propertyId" required uuid />
          <Field label="Room Type ID" name="roomTypeId" required uuid />
          <Field label="Llegada" name="arrival" type="date" required />
          <Field label="Salida" name="departure" type="date" required />
          <Field label="Adultos" name="adults" type="number" min={1} defaultValue="2" />
          <Field label="Niños" name="children" type="number" min={0} defaultValue="0" />
        </Section>

        <Section title="Huésped principal">
          <Field label="Nombre" name="firstName" required />
          <Field label="Apellidos" name="lastName" required />
          <Field label="Email" name="email" type="email" />
          <Field label="Teléfono" name="phone" />
        </Section>

        <div>
          <label className="block text-sm font-medium text-aubergine-700">Notas</label>
          <textarea
            name="notes"
            rows={3}
            className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
          />
        </div>

        <input type="hidden" name="walkIn" value={isWalkIn ? 'on' : 'off'} />

        <div className="flex justify-end gap-3">
          <a
            href="/reservations"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 transition hover:bg-aubergine-50"
          >
            Cancelar
          </a>
          <button
            type="submit"
            className="rounded-lg bg-aubergine-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-aubergine-700"
          >
            {isWalkIn ? 'Crear y check-in' : 'Crear reserva'}
          </button>
        </div>
      </form>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
        {title}
      </legend>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required,
  uuid,
  min,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  uuid?: boolean;
  min?: number;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-aubergine-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        min={min}
        defaultValue={defaultValue}
        pattern={
          uuid
            ? '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
            : undefined
        }
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}
