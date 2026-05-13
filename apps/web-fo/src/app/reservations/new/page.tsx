import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  ApiError,
  assignRoom,
  createReservation,
  listRooms,
  searchAvailabilityByType,
} from '@/lib/api';
import { getActivePropertyId } from '@/lib/active-property';

export const dynamic = 'force-dynamic';

interface SearchParams {
  step?: string;
  arrival?: string;
  departure?: string;
  adults?: string;
  children?: string;
  roomTypeId?: string;
  walkIn?: string;
}

const TODAY = () => new Date().toISOString().slice(0, 10);
const TOMORROW = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export default async function NewReservationWizardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const propertyId = await getActivePropertyId();
  if (!propertyId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          No hay propiedad activa. Configúrala en el selector del nav.
        </p>
      </main>
    );
  }

  const arrival = searchParams.arrival ?? TODAY();
  const departure = searchParams.departure ?? TOMORROW();
  const adults = Number(searchParams.adults ?? '2');
  const children = Number(searchParams.children ?? '0');
  const isWalkIn = searchParams.walkIn === '1';
  const step = searchParams.step ?? '1';

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Reservas
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">
          {isWalkIn ? 'Walk-in' : 'Nueva reserva'}
        </h1>
        <Steps current={step} />
      </header>

      {step === '1' && (
        <StepEstancia
          arrival={arrival}
          departure={departure}
          adults={adults}
          children={children}
          isWalkIn={isWalkIn}
        />
      )}

      {step === '2' && (
        <StepTipo
          accessToken={session?.accessToken}
          propertyId={propertyId}
          arrival={arrival}
          departure={departure}
          adults={adults}
          children={children}
          isWalkIn={isWalkIn}
        />
      )}

      {step === '3' && searchParams.roomTypeId && (
        <StepHuesped
          accessToken={session?.accessToken}
          propertyId={propertyId}
          arrival={arrival}
          departure={departure}
          adults={adults}
          children={children}
          roomTypeId={searchParams.roomTypeId}
          isWalkIn={isWalkIn}
        />
      )}
    </main>
  );
}

function Steps({ current }: { current: string }) {
  const steps = [
    { id: '1', label: 'Estancia' },
    { id: '2', label: 'Tipo + tarifa' },
    { id: '3', label: 'Huésped' },
  ];
  return (
    <ol className="mt-3 flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={
            s.id === current
              ? 'rounded-full bg-aubergine-700 px-3 py-1 font-medium text-white'
              : 'rounded-full bg-aubergine-50 px-3 py-1 text-aubergine-700/60'
          }
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Paso 1 — Estancia
// ---------------------------------------------------------------------------

function StepEstancia(props: {
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  isWalkIn: boolean;
}) {
  return (
    <form
      action="/reservations/new"
      method="get"
      className="space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100"
    >
      <input type="hidden" name="step" value="2" />
      {props.isWalkIn && <input type="hidden" name="walkIn" value="1" />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Llegada" name="arrival" type="date" defaultValue={props.arrival} required />
        <Field
          label="Salida"
          name="departure"
          type="date"
          defaultValue={props.departure}
          required
        />
        <Field
          label="Adultos"
          name="adults"
          type="number"
          min={1}
          defaultValue={String(props.adults)}
        />
        <Field
          label="Niños"
          name="children"
          type="number"
          min={0}
          defaultValue={String(props.children)}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-lg bg-aubergine-700 px-5 py-2.5 text-sm font-medium text-white"
        >
          Buscar disponibilidad →
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Paso 2 — Tipo de habitación + tarifa
// ---------------------------------------------------------------------------

async function StepTipo(props: {
  accessToken: string | undefined;
  propertyId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  isWalkIn: boolean;
}) {
  let types: Awaited<ReturnType<typeof searchAvailabilityByType>> = [];
  let error: string | null = null;
  try {
    types = await searchAvailabilityByType(props.accessToken, {
      propertyId: props.propertyId,
      arrival: props.arrival,
      departure: props.departure,
    });
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-aubergine-50 p-4 text-sm text-aubergine-700">
        <strong className="font-semibold">{props.arrival}</strong> →{' '}
        <strong className="font-semibold">{props.departure}</strong> · {props.adults} adultos
        {props.children > 0 ? ` + ${props.children} niños` : ''}
        <a
          href={`/reservations/new?step=1&arrival=${props.arrival}&departure=${props.departure}&adults=${props.adults}&children=${props.children}${
            props.isWalkIn ? '&walkIn=1' : ''
          }`}
          className="ml-3 text-aubergine-500 underline"
        >
          editar
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {types.map((t) => {
          const enoughCapacity = t.maxOccupancy >= props.adults + props.children;
          const free = t.availableRooms > 0;
          const disabled = !enoughCapacity || !free;
          return (
            <a
              key={t.roomTypeId}
              href={
                disabled
                  ? '#'
                  : `/reservations/new?step=3&arrival=${props.arrival}&departure=${props.departure}&adults=${props.adults}&children=${props.children}&roomTypeId=${t.roomTypeId}${
                      props.isWalkIn ? '&walkIn=1' : ''
                    }`
              }
              className={
                disabled
                  ? 'cursor-not-allowed rounded-2xl bg-white p-4 opacity-50 ring-1 ring-aubergine-100'
                  : 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100 transition hover:ring-2 hover:ring-aubergine-300'
              }
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-base font-semibold text-aubergine-700">{t.name}</h3>
                <span className="text-xs text-aubergine-700/60">{t.code}</span>
              </div>
              {t.description && (
                <p className="mt-1 text-xs text-aubergine-700/70">{t.description}</p>
              )}
              <p className="mt-3 text-xs text-aubergine-700/60">
                Capacidad {t.baseOccupancy}-{t.maxOccupancy} pax
                {!enoughCapacity && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 text-amber-800">
                    no caben
                  </span>
                )}
              </p>
              <p className="mt-2 text-xs text-aubergine-700/60">
                <strong className="text-aubergine-700">{t.availableRooms}</strong>/{t.totalRooms}{' '}
                disponibles
                {!free && (
                  <span className="ml-2 rounded bg-rose-100 px-1.5 text-rose-800">
                    completo
                  </span>
                )}
              </p>
              <div className="mt-4 border-t border-aubergine-100 pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-aubergine-700/60">{t.pricePerNight} €/noche</span>
                  <span className="text-lg font-semibold text-aubergine-700">
                    {t.totalForStay} {t.currency}
                  </span>
                </div>
                <p className="text-[10px] text-aubergine-700/50">
                  {t.nights} noche{t.nights > 1 ? 's' : ''}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paso 3 — Huésped + confirmación
// ---------------------------------------------------------------------------

async function StepHuesped(props: {
  accessToken: string | undefined;
  propertyId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  roomTypeId: string;
  isWalkIn: boolean;
}) {
  const propsCopy = props;

  async function submit(formData: FormData) {
    'use server';
    const session = await auth();
    const firstName = formData.get('firstName')?.toString().trim();
    const lastName = formData.get('lastName')?.toString().trim();
    const email = formData.get('email')?.toString().trim() || undefined;
    const phone = formData.get('phone')?.toString().trim() || undefined;
    const notes = formData.get('notes')?.toString() || undefined;

    if (!firstName || !lastName) throw new Error('Nombre y apellidos requeridos');

    try {
      const created = await createReservation(session?.accessToken, {
        propertyId: propsCopy.propertyId,
        roomTypeId: propsCopy.roomTypeId,
        arrival: propsCopy.arrival,
        departure: propsCopy.departure,
        guestData: { firstName, lastName, email, phone },
        occupancy: { adults: propsCopy.adults, children: propsCopy.children },
        notes,
        walkIn: propsCopy.isWalkIn,
      });

      // Walk-in: auto-asignar primera habitación libre del tipo elegido.
      if (propsCopy.isWalkIn) {
        const rooms = await listRooms(session?.accessToken, { propertyId: propsCopy.propertyId });
        const free = rooms.find(
          (r) =>
            r.roomTypeId === propsCopy.roomTypeId &&
            !r.isOutOfOrder &&
            (r.status === 'CLEAN' || r.status === 'INSPECTED'),
        );
        if (free) {
          await assignRoom(session?.accessToken, created.id, free.id);
        }
      }

      redirect(`/reservations/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        throw new Error(`API ${err.status}: ${err.body}`);
      }
      throw err;
    }
  }

  return (
    <form
      action={submit}
      className="space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100"
    >
      <div className="rounded-xl bg-aubergine-50 p-3 text-xs text-aubergine-700">
        Resumen: <strong>{props.arrival}</strong> → <strong>{props.departure}</strong> ·{' '}
        {props.adults} adultos
        {props.children > 0 ? ` + ${props.children} niños` : ''} · tipo {props.roomTypeId.slice(0, 8)}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" name="firstName" required />
        <Field label="Apellidos" name="lastName" required />
        <Field label="Email" name="email" type="email" />
        <Field label="Teléfono" name="phone" />
      </div>

      <label className="block text-sm">
        <span className="font-medium text-aubergine-700">Notas (opcional)</span>
        <textarea
          name="notes"
          rows={3}
          className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <a
          href={`/reservations/new?step=2&arrival=${props.arrival}&departure=${props.departure}&adults=${props.adults}&children=${props.children}${
            props.isWalkIn ? '&walkIn=1' : ''
          }`}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
        >
          ← Cambiar tipo
        </a>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-700 px-5 py-2.5 text-sm font-medium text-white"
        >
          {props.isWalkIn ? 'Crear y check-in' : 'Confirmar reserva'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Field shared
// ---------------------------------------------------------------------------

function Field({
  label,
  name,
  type = 'text',
  required,
  min,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
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
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}
