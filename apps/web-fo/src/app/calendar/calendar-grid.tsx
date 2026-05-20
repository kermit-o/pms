'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AvailabilityMatrix } from '@/lib/api';
import {
  detectRoomConflicts,
  resolveAction,
  type DnDReservation,
  type DragAction,
  type ReservationStatus,
} from './dnd-rules';

interface Props {
  matrix: AvailabilityMatrix;
  today: string;
}

/**
 * Sprint 12 W4 — Grid del calendario con HTML5 drag & drop nativo.
 *
 * - Arrastra la barra de una reserva (sólo en la celda donde empieza)
 *   hasta una celda destino: (room, date).
 * - El resolutor (`dnd-rules.ts`) decide si la acción es check-in,
 *   check-out, assign-room o no soportada.
 * - Antes de aplicar, valida conflictos en la habitación destino y
 *   muestra un modal de confirmación con resumen.
 */
export function CalendarGrid({ matrix, today }: Props) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    action: DragAction;
    reservationCode: string;
    targetLabel: string;
    conflicts: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayMeta = useMemo(
    () =>
      matrix.days.map((iso) => {
        const d = new Date(iso);
        return {
          iso,
          label: `${d.getDate()}/${d.getMonth() + 1}`,
          isWeekend: d.getDay() === 0 || d.getDay() === 6,
          isToday: iso === today,
        };
      }),
    [matrix.days, today],
  );

  // Mapa rápido reservationId → reserva (los cells sólo tienen un subset).
  const resIndex = useMemo(() => {
    const idx = new Map<string, DnDReservation & { sourceRoomId: string | null }>();
    for (const room of matrix.rooms) {
      const roomCells = matrix.cells[room.id] ?? {};
      for (const [date, cell] of Object.entries(roomCells)) {
        if (!cell.reservation) continue;
        const r = cell.reservation;
        if (r.arrivalDate !== date) continue; // sólo registramos en su celda de origen
        idx.set(r.id, {
          id: r.id,
          code: r.code,
          status: r.status as ReservationStatus,
          arrivalDate: r.arrivalDate,
          departureDate: r.departureDate,
          roomId: room.id,
          sourceRoomId: room.id,
        });
      }
    }
    return idx;
  }, [matrix]);

  function onDragStart(e: React.DragEvent<HTMLDivElement>, reservationId: string) {
    setDragId(reservationId);
    setError(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/reservation-id', reservationId);
  }

  function onDragEnd() {
    setDragId(null);
    setDragOver(null);
  }

  function onDragOverCell(e: React.DragEvent<HTMLTableCellElement>, cellKey: string) {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== cellKey) setDragOver(cellKey);
  }

  function onDropCell(e: React.DragEvent<HTMLTableCellElement>, roomId: string, date: string) {
    e.preventDefault();
    setDragOver(null);
    const reservationId = e.dataTransfer.getData('text/reservation-id') || dragId;
    setDragId(null);
    if (!reservationId) return;
    const res = resIndex.get(reservationId);
    if (!res) {
      setError('Reserva no encontrada en el grid.');
      return;
    }
    const action = resolveAction({
      reservation: res,
      sourceRoomId: res.sourceRoomId,
      targetRoomId: roomId,
      targetDate: date,
      today,
    });
    if (action.kind === 'unsupported') {
      setError(action.reason);
      return;
    }
    const targetRoom = matrix.rooms.find((r) => r.id === roomId);
    const targetLabel = `${targetRoom?.number ?? '?'} · ${date}`;
    const conflicts =
      action.kind === 'assign-room'
        ? detectRoomConflicts({
            targetRoomId: roomId,
            range: { arrival: res.arrivalDate, departure: res.departureDate },
            excludeReservationId: res.id,
            cellsForRoom: matrix.cells[roomId] ?? {},
          })
        : [];
    setPending({ action, reservationCode: res.code, targetLabel, conflicts });
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const { action } = pending;
      if (action.kind === 'unsupported') return;
      const path =
        action.kind === 'check-in'
          ? `/api/reservations/${action.reservationId}/check-in`
          : action.kind === 'check-out'
            ? `/api/reservations/${action.reservationId}/check-out`
            : `/api/reservations/${action.reservationId}/assign-room`;
      const body =
        action.kind === 'check-in' || action.kind === 'assign-room'
          ? { roomId: action.roomId }
          : {};
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      setPending(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="mb-3 rounded-xl bg-rose-50 px-4 py-2 text-xs text-rose-800 ring-1 ring-rose-200">
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
              {dayMeta.map((d) => (
                <th
                  key={d.iso}
                  className={`w-14 px-1 py-2 font-normal ${
                    d.isToday
                      ? 'bg-aubergine-600 text-white'
                      : d.isWeekend
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
                    return (
                      <td
                        key={d.iso}
                        className="h-10 border-t border-aubergine-100 px-0.5"
                        onDragOver={(e) => onDragOverCell(e, `${room.id}|${d.iso}`)}
                        onDrop={(e) => onDropCell(e, room.id, d.iso)}
                      />
                    );
                  }
                  const cls = cellStyle(cell.state, d.isWeekend);
                  const startsHere = cell.reservation && cell.reservation.arrivalDate === d.iso;
                  const isFree = !cell.reservation && cell.state !== 'OOO';
                  const isOver = dragOver === `${room.id}|${d.iso}`;
                  return (
                    <td
                      key={d.iso}
                      className={`h-10 border-t border-aubergine-100 px-0.5 align-middle ${cls} ${
                        isOver ? 'outline outline-2 outline-aubergine-600' : ''
                      }`}
                      title={
                        cell.reservation
                          ? `${cell.reservation.code} · ${cell.reservation.arrivalDate} → ${cell.reservation.departureDate}`
                          : cell.state
                      }
                      onDragOver={(e) => onDragOverCell(e, `${room.id}|${d.iso}`)}
                      onDrop={(e) => onDropCell(e, room.id, d.iso)}
                    >
                      {startsHere && cell.reservation && (
                        <div
                          draggable
                          onDragStart={(e) => onDragStart(e, cell.reservation!.id)}
                          onDragEnd={onDragEnd}
                          className={`block cursor-grab truncate px-1 text-[10px] font-mono text-white active:cursor-grabbing ${
                            dragId === cell.reservation.id ? 'opacity-40' : ''
                          }`}
                        >
                          <Link
                            href={`/reservations/${cell.reservation.id}`}
                            className="block truncate"
                            onDragStart={(e) => e.preventDefault()}
                          >
                            {cell.reservation.code.split('-').slice(1).join('-')}
                          </Link>
                        </div>
                      )}
                      {isFree && !dragId && (
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

      {pending && (
        <ConfirmModal
          pending={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void apply()}
        />
      )}
    </>
  );
}

function ConfirmModal({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: {
    action: DragAction;
    reservationCode: string;
    targetLabel: string;
    conflicts: string[];
  };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { action, reservationCode, targetLabel, conflicts } = pending;
  if (action.kind === 'unsupported') return null;
  const title =
    action.kind === 'check-in'
      ? 'Check-in'
      : action.kind === 'check-out'
        ? 'Check-out anticipado'
        : 'Cambio de habitación';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-aubergine-700">{title}</h3>
        <p className="mt-2 text-sm text-aubergine-700/80">
          Reserva <strong className="font-mono">{reservationCode}</strong> → {targetLabel}
        </p>
        {conflicts.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
            <p className="font-semibold">Habitación ocupada en parte del rango:</p>
            <ul className="mt-1 list-disc pl-5 font-mono">
              {conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-2">Resuelve estos conflictos antes de confirmar.</p>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg bg-white px-4 py-2 text-sm text-aubergine-700 ring-1 ring-aubergine-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || conflicts.length > 0}
            className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Procesando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
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

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
