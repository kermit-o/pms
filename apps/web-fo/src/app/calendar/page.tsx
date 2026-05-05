import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, listReservations } from '@/lib/api';
import type { ReservationListItem } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { from?: string; days?: string };
}

const DEFAULT_DAYS = 14;

export default async function CalendarPage({ searchParams }: PageProps) {
  const session = await auth();

  const from = searchParams.from ?? toIsoDate(new Date());
  const days = clamp(Number(searchParams.days ?? DEFAULT_DAYS), 7, 60);
  const fromDate = new Date(from);
  const toDate = addDays(fromDate, days);
  const to = toIsoDate(toDate);

  let items: ReservationListItem[] = [];
  let error: string | null = null;
  try {
    const res = await listReservations(session?.accessToken, {
      from,
      to,
      limit: 200,
    });
    items = res.items;
  } catch (err) {
    error =
      err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  // Group reservations by roomId (only ones with a room assigned).
  // Unassigned reservations show in the "No asignada" lane.
  const byRoom = new Map<string, ReservationListItem[]>();
  const unassigned: ReservationListItem[] = [];
  for (const r of items) {
    if (r.roomId) {
      if (!byRoom.has(r.roomId)) byRoom.set(r.roomId, []);
      byRoom.get(r.roomId)!.push(r);
    } else {
      unassigned.push(r);
    }
  }

  const dayList: { iso: string; label: string; isWeekend: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(fromDate, i);
    dayList.push({
      iso: toIsoDate(d),
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    });
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-10">
      <header className="flex items-end justify-between">
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
          <Link
            href={`/calendar?from=${toIsoDate(addDays(fromDate, -days))}&days=${days}`}
            className="rounded-lg bg-white px-3 py-1.5 text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            ← Anterior
          </Link>
          <Link
            href={`/calendar?from=${toIsoDate(addDays(fromDate, days))}&days=${days}`}
            className="rounded-lg bg-white px-3 py-1.5 text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            Siguiente →
          </Link>
          <Link
            href="/reservations/new"
            className="rounded-lg bg-aubergine-600 px-3 py-1.5 text-white hover:bg-aubergine-700"
          >
            Nueva reserva
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      <section className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-32 bg-aubergine-50 px-3 py-2 text-left text-aubergine-500">
                Habitación
              </th>
              {dayList.map((d) => (
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
            {byRoom.size === 0 && unassigned.length === 0 && (
              <tr>
                <td
                  colSpan={dayList.length + 1}
                  className="px-3 py-12 text-center text-aubergine-700/60"
                >
                  Sin reservas en este rango.
                </td>
              </tr>
            )}
            {[...byRoom.entries()].map(([roomId, reservations]) => (
              <Row
                key={roomId}
                label={roomId.slice(0, 6)}
                reservations={reservations}
                dayList={dayList}
                fromDate={fromDate}
              />
            ))}
            {unassigned.length > 0 && (
              <Row
                label="No asignada"
                reservations={unassigned}
                dayList={dayList}
                fromDate={fromDate}
              />
            )}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-aubergine-700/60">
        Drag-to-create + grid completo (todas las habitaciones aunque no
        tengan reservas) llega en S2-W3 con el endpoint
        <code className="mx-1">/rooms/availability</code>.
      </p>
    </main>
  );
}

function Row({
  label,
  reservations,
  dayList,
  fromDate,
}: {
  label: string;
  reservations: ReservationListItem[];
  dayList: { iso: string; isWeekend: boolean }[];
  fromDate: Date;
}) {
  return (
    <tr>
      <td className="sticky left-0 z-10 w-32 border-t border-aubergine-100 bg-white px-3 py-2 font-mono text-xs text-aubergine-700">
        {label}
      </td>
      {dayList.map((d) => {
        const r = reservations.find(
          (x) => x.arrivalDate <= d.iso && x.departureDate > d.iso,
        );
        const isStart = r && r.arrivalDate === d.iso;
        const isEnd =
          r && toIsoDate(addDays(new Date(r.departureDate), -1)) === d.iso;
        const cls = r
          ? `${STATUS_COLORS[r.status] ?? 'bg-slate-300'} text-white`
          : d.isWeekend
            ? 'bg-aubergine-50/60'
            : '';
        const radius = r
          ? `${isStart ? 'rounded-l-md' : ''} ${isEnd ? 'rounded-r-md' : ''}`
          : '';
        return (
          <td
            key={d.iso}
            className={`h-10 border-t border-aubergine-100 px-0.5 align-middle ${cls} ${radius}`}
            title={
              r ? `${r.code} · ${r.arrivalDate} → ${r.departureDate}` : ''
            }
          >
            {isStart && r && (
              <Link
                href={`/reservations/${r.id}`}
                className="block truncate px-1 text-[10px] font-mono"
              >
                {r.code.split('-')[1]}
              </Link>
            )}
          </td>
        );
      })}
    </tr>
  );
  void fromDate;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-500',
  CONFIRMED: 'bg-blue-500',
  CHECKED_IN: 'bg-emerald-500',
  CHECKED_OUT: 'bg-slate-400',
  CANCELLED: 'bg-rose-400',
  NO_SHOW: 'bg-orange-500',
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}
