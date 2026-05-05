import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  ApiError,
  changeRoomStatus,
  listRooms,
  type RoomListItem,
  type RoomStatus,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string };
}

export default async function RoomsPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;

  let rooms: RoomListItem[] = [];
  let error: string | null = null;
  try {
    rooms = await listRooms(session?.accessToken, { propertyId });
  } catch (err) {
    error =
      err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  async function setStatus(formData: FormData) {
    'use server';
    const session = await auth();
    const roomId = formData.get('roomId')?.toString();
    const status = formData.get('status')?.toString() as RoomStatus;
    const reason = formData.get('outOfOrderReason')?.toString().trim();
    if (!roomId || !status) throw new Error('Faltan campos');
    await changeRoomStatus(session?.accessToken, roomId, status, reason || undefined);
    revalidatePath('/rooms');
  }

  // Group rooms by floor for readability
  const byFloor = new Map<string, RoomListItem[]>();
  for (const r of rooms) {
    const f = r.floor ?? '—';
    if (!byFloor.has(f)) byFloor.set(f, []);
    byFloor.get(f)!.push(r);
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Habitaciones
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">
          Estado de habitaciones
        </h1>
        <p className="text-sm text-aubergine-700/70">
          Cambios reflejan en el calendar y disparan{' '}
          <code className="rounded bg-aubergine-50 px-1 py-0.5">room.status_changed</code>{' '}
          al bus de eventos.
        </p>
      </header>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {[...byFloor.entries()].map(([floor, list]) => (
        <section
          key={floor}
          className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100"
        >
          <header className="bg-aubergine-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-aubergine-500">
            Planta {floor}
          </header>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-aubergine-500">
              <tr>
                <th className="px-4 py-2 w-24">Hab.</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Motivo OOO</th>
                <th className="px-4 py-2 text-right">Cambiar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-aubergine-100/70">
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono font-medium">{r.number}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-aubergine-700/70">
                    {r.outOfOrderReason ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={setStatus} className="inline-flex items-center gap-2">
                      <input type="hidden" name="roomId" value={r.id} />
                      <select
                        name="status"
                        defaultValue={r.status}
                        className="rounded-lg border border-aubergine-100 bg-white px-2 py-1 text-xs focus:border-aubergine-500 focus:outline-none"
                      >
                        <option value="CLEAN">Clean</option>
                        <option value="DIRTY">Dirty</option>
                        <option value="INSPECTED">Inspected</option>
                        <option value="OUT_OF_ORDER">Out of order</option>
                        <option value="OUT_OF_SERVICE">Out of service</option>
                      </select>
                      <input
                        type="text"
                        name="outOfOrderReason"
                        placeholder="motivo"
                        defaultValue={r.outOfOrderReason ?? ''}
                        className="rounded-lg border border-aubergine-100 bg-white px-2 py-1 text-xs focus:border-aubergine-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-aubergine-600 px-2 py-1 text-xs font-medium text-white hover:bg-aubergine-700"
                      >
                        Aplicar
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {rooms.length === 0 && !error && (
        <div className="rounded-2xl bg-white p-12 text-center text-aubergine-700/60 ring-1 ring-aubergine-100">
          Sin habitaciones para este property.
        </div>
      )}
    </main>
  );
}

const STATUS_STYLES: Record<string, string> = {
  CLEAN: 'bg-emerald-100 text-emerald-800',
  DIRTY: 'bg-amber-100 text-amber-800',
  INSPECTED: 'bg-blue-100 text-blue-800',
  OUT_OF_ORDER: 'bg-rose-100 text-rose-800',
  OUT_OF_SERVICE: 'bg-slate-200 text-slate-700',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {status.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}
