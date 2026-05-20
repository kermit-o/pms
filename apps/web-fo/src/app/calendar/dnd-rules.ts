/**
 * Sprint 12 W4 — pure rule engine for calendar drag & drop.
 *
 * Decide qué transición (si alguna) corresponde cuando el operador suelta
 * una reserva sobre una celda (roomId, date). Sin side effects — la lógica
 * de fetch vive en el componente cliente.
 */

export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface DnDReservation {
  id: string;
  code: string;
  status: ReservationStatus;
  arrivalDate: string; // YYYY-MM-DD
  departureDate: string; // YYYY-MM-DD
  roomId: string | null;
}

export type DragAction =
  | { kind: 'check-in'; reservationId: string; roomId: string }
  | { kind: 'check-out'; reservationId: string }
  | { kind: 'assign-room'; reservationId: string; roomId: string }
  | { kind: 'unsupported'; reason: string };

export interface ResolveInput {
  reservation: DnDReservation;
  sourceRoomId: string | null;
  targetRoomId: string;
  targetDate: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
}

export function resolveAction(input: ResolveInput): DragAction {
  const { reservation, sourceRoomId, targetRoomId, targetDate, today } = input;
  const sameRoom = sourceRoomId === targetRoomId;

  switch (reservation.status) {
    case 'PENDING':
    case 'CONFIRMED':
      if (targetDate !== today) {
        return {
          kind: 'unsupported',
          reason:
            'Check-in solo se hace en la fecha de hoy. Arrastra a la columna de hoy.',
        };
      }
      return { kind: 'check-in', reservationId: reservation.id, roomId: targetRoomId };
    case 'CHECKED_IN':
      if (!sameRoom) {
        return { kind: 'assign-room', reservationId: reservation.id, roomId: targetRoomId };
      }
      if (targetDate < today) {
        return { kind: 'check-out', reservationId: reservation.id };
      }
      if (targetDate === today) {
        return { kind: 'check-out', reservationId: reservation.id };
      }
      return {
        kind: 'unsupported',
        reason:
          'Para check-out anticipado arrastra a hoy o antes; el check-out estándar usa la ficha.',
      };
    default:
      return {
        kind: 'unsupported',
        reason: `Reserva en estado ${reservation.status} no admite drag & drop.`,
      };
  }
}

/**
 * Devuelve los códigos de las reservas que ocupan la habitación destino
 * dentro del rango [arrival, departure). Vacío si no hay conflictos.
 */
export function detectRoomConflicts(input: {
  targetRoomId: string;
  range: { arrival: string; departure: string };
  excludeReservationId: string;
  cellsForRoom: Record<string, { reservation: { id: string; code: string } | null }>;
}): string[] {
  const conflicts = new Set<string>();
  let cursor = input.range.arrival;
  while (cursor < input.range.departure) {
    const cell = input.cellsForRoom[cursor];
    if (cell?.reservation && cell.reservation.id !== input.excludeReservationId) {
      conflicts.add(cell.reservation.code);
    }
    cursor = addDaysIso(cursor, 1);
  }
  return [...conflicts];
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
