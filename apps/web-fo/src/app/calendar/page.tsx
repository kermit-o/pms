import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, getRoomAvailability, type AvailabilityMatrix } from '@/lib/api';
import { getActivePropertyId } from '@/lib/active-property';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; from?: string; days?: string };
}

const DEFAULT_DAYS = 14;

export default async function CalendarPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId ?? (await getActivePropertyId()) ?? undefined;
  const from = searchParams.from ?? toIsoDate(new Date());
  const days = clamp(Number(searchParams.days ?? DEFAULT_DAYS), 7, 60);
  const fromDate = new Date(from);
  const toDate = addDays(fromDate, days);
  const to = toIsoDate(toDate);

  let matrix: AvailabilityMatrix | null = null;
  let error: string | null = null;
  if (!propertyId) {
    error = 'No hay propiedad activa. Configúrala en el selector del nav.';
  } else {
    try {
      matrix = await getRoomAvailability(session?.accessToken, {
        propertyId,
        from,
        to,
      });
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
    }
  }

  return (
    <main className="mx-auto max-w-[1500px] space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
            Aubergine · Front Office
          </p>
          <h1 className="text-3xl font-semibold text-aubergine-700">Calendar</h1>
          <p className="text-sm text-aubergine-700/70">
            {from} → {to} · {days} días
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <NavButton
            propertyId={propertyId}
            from={toIsoDate(addDays(fromDate, -days))}
            days={days}
            label="← Anterior"
          />
          <NavButton
            propertyId={propertyId}
            from={toIsoDate(addDays(fromDate, days))}
            days={days}
            label="Siguiente →"
          />
          <Link
            href={`/reservations/new?step=1&arrival=${from}&departure=${toIsoDate(addDays(fromDate, 1))}`}
            className="rounded-lg bg-aubergine-600 px-3 py-1.5 text-white hover:bg-aubergine-700"
          >
            Nueva reserva
          </Link>
        </div>
      </header>

      <DateRangeForm from={from} days={days} />

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {matrix && <Grid matrix={matrix} />}
    </main>
  );
}

function DateRangeForm({ from, days }: { from: string; days: number }) {
  return (
    <form
      method="get"
      action="/calendar"
      className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-aubergine-100"
    >
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
        Días
        <input
          name="days"
          type="number"
          min={7}
          max={60}
          defaultValue={days}
          className="mt-1 block w-20 rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-aubergine-600 px-3 py-2 text-sm font-medium text-white hover:bg-aubergine-700"
      >
        Aplicar
      </button>
    </form>
  );
}

function NavButton({
  propertyId,
  from,
  days,
  label,
}: {
  propertyId: string | undefined;
  from: string;
  days: number;
  label: string;
}) {
  const params = new URLSearchParams({ from, days: String(days) });
  if (propertyId) params.set('propertyId', propertyId);
  return (
    <Link
      href={`/calendar?${params.toString()}`}
      className="rounded-lg bg-white px-3 py-1.5 text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
    >
      {label}
    </Link>
  );
}

function Grid({ matrix }: { matrix: AvailabilityMatrix }) {
  const dayMeta = matrix.days.map((iso) => {
    const d = new Date(iso);
    return {
      iso,
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  });

  return (
    <section className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-32 bg-aubergine-50 px-3 py-2 text-left text-aubergine-500">
              Habitación
            </th>
            {dayMeta.map((d) => (
              <th
                key={d.iso}
                className={`w-14 px-1 py-2 font-normal ${
                  d.isWeekend
                    ? 'bg-aubergine-100/50 text-aubergine-700'
                    : 'bg-aubergine-50 text-aubergine-500'
                }`}
              >
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rooms.length === 0 && (
            <tr>
              <td
                colSpan={dayMeta.length + 1}
                className="px-3 py-12 text-center text-aubergine-700/60"
              >
                Sin habitaciones para este property.
              </td>
            </tr>
          )}
          {matrix.rooms.map((room) => (
            <tr key={room.id}>
              <td className="sticky left-0 z-10 w-32 border-t border-aubergine-100 bg-white px-3 py-2 font-mono text-xs text-aubergine-700">
                {room.number}
                {room.floor && <span className="ml-2 text-aubergine-700/50">P{room.floor}</span>}
              </td>
              {dayMeta.map((d) => {
                const cell = matrix.cells[room.id]?.[d.iso];
                const nextDay = addDaysIso(d.iso, 1);
                if (!cell) {
                  return <td key={d.iso} className="h-10 border-t border-aubergine-100 px-0.5" />;
                }
                const cls = cellStyle(cell.state, d.isWeekend);
                const startsHere = cell.reservation && cell.reservation.arrivalDate === d.iso;
                const isFree = !cell.reservation && cell.state !== 'OOO';
                return (
                  <td
                    key={d.iso}
                    className={`h-10 border-t border-aubergine-100 px-0.5 align-middle ${cls}`}
                    title={
                      cell.reservation
                        ? `${cell.reservation.code} · ${cell.reservation.arrivalDate} → ${cell.reservation.departureDate}`
                        : cell.state
                    }
                  >
                    {startsHere && cell.reservation && (
                      <Link
                        href={`/reservations/${cell.reservation.id}`}
                        className="block truncate px-1 text-[10px] font-mono text-white"
                      >
                        {cell.reservation.code.split('-').slice(1).join('-')}
                      </Link>
                    )}
                    {isFree && (
                      <Link
                        href={`/reservations/new?step=3&arrival=${d.iso}&departure=${nextDay}&adults=2&children=0&roomTypeId=${room.roomTypeId}`}
                        className="block h-full w-full text-transparent hover:text-aubergine-700"
                        title={`Crear reserva: ${room.number} · ${d.iso}`}
                      >
                        +
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function cellStyle(state: string, isWeekend: boolean): string {
  switch (state) {
    case 'OCC':
      return 'bg-emerald-500';
    case 'OOO':
      return 'bg-rose-400';
    case 'OUT_OF_SERVICE':
      return 'bg-slate-300';
    case 'DIRTY':
      return 'bg-amber-100';
    case 'INSPECTED':
      return 'bg-blue-100';
    case 'CLEAN':
    default:
      return isWeekend ? 'bg-aubergine-50/60' : '';
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function addDaysIso(iso: string, n: number): string {
  return toIsoDate(addDays(new Date(iso), n));
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}
