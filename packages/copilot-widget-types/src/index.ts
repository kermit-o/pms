/**
 * PMS Copilot — Widget types compartidos.
 *
 * Discriminated union de las tarjetas estructuradas que el Copilot
 * emite junto al texto del LLM. La fuente única de verdad vive aquí
 * para que `apps/api` (productor) y `apps/web-fo` (renderer) no
 * diverjan en runtime — la duplicación causaba que un cambio en uno
 * compilara mientras el otro fallaba silenciosamente al deserializar.
 *
 * Patrón:
 *  - Cada widget tiene `kind` literal + `data` con la forma estable.
 *  - Nuevos widgets se añaden como variantes nuevas; los clientes
 *    que no las reconozcan caen al `return null` del switch en el
 *    sidebar (fallback al texto del LLM).
 *  - Sin lógica, sin runtime — sólo tipos. Cero deps.
 */

// ---------------------------------------------------------------------------
// availability — search_availability_by_type
// ---------------------------------------------------------------------------

export interface AvailabilityRow {
  roomTypeId: string;
  code: string;
  name: string;
  description: string | null;
  maxOccupancy: number;
  available: number;
  totalRooms: number;
  pricePerNight: string;
  totalForStay: string;
  currency: string;
}

export interface AvailabilityWidgetData {
  arrival: string;
  departure: string;
  nights: number;
  rows: AvailabilityRow[];
}

// ---------------------------------------------------------------------------
// folio — get_folio
// ---------------------------------------------------------------------------

export interface FolioEntry {
  id: string;
  type: string;
  description: string;
  amount: string;
  currency: string;
  postedAt: string;
}

export interface FolioWidgetData {
  folioId: string;
  reservationCode: string;
  reservationId: string;
  status: string;
  balance: string;
  currency: string;
  entries: FolioEntry[];
}

// ---------------------------------------------------------------------------
// reservation — get_reservation
// ---------------------------------------------------------------------------

export interface ReservationWidgetData {
  reservationId: string;
  reservationCode: string;
  status: string;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  totalAmount: string;
  currency: string;
  roomTypeCode: string;
  roomTypeName: string;
  roomNumber: string | null;
  guest: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
  guaranteeStatus: string;
  guaranteeType: string;
  cardBrand: string | null;
  cardLast4: string | null;
  folio: { id: string; status: string; balance: string; currency: string } | null;
}

// ---------------------------------------------------------------------------
// hsk_tasks — hsk_list_today
// ---------------------------------------------------------------------------

export interface HskTaskRow {
  id: string;
  roomNumber: string | null;
  roomFloor: string | null;
  taskType: string;
  status: string;
  assigneeName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number | null;
  notes: string | null;
}

export interface HskTasksWidgetData {
  businessDate: string;
  rows: HskTaskRow[];
  counts: {
    PENDING: number;
    IN_PROGRESS: number;
    DONE: number;
    BLOCKED: number;
  };
}

// ---------------------------------------------------------------------------
// movements — list_movements (arrivals + departures con un único tool)
// ---------------------------------------------------------------------------

export interface MovementRow {
  reservationId: string;
  reservationCode: string;
  guestFirstName: string | null;
  guestLastName: string | null;
  roomNumber: string | null;
  roomTypeCode: string | null;
  adults: number;
  children: number;
  totalAmount: string;
  currency: string;
  status: string;
  guaranteeStatus: string;
  folioBalance: string | null;
}

export interface MovementsWidgetData {
  /** 'arrival' (entradas previstas) o 'departure' (salidas previstas). */
  direction: 'arrival' | 'departure';
  businessDate: string;
  rows: MovementRow[];
}

// ---------------------------------------------------------------------------
// Discriminated union — la lista crece añadiendo variantes nuevas.
// ---------------------------------------------------------------------------

export type CopilotWidget =
  | { kind: 'availability'; data: AvailabilityWidgetData }
  | { kind: 'folio'; data: FolioWidgetData }
  | { kind: 'reservation'; data: ReservationWidgetData }
  | { kind: 'hsk_tasks'; data: HskTasksWidgetData }
  | { kind: 'movements'; data: MovementsWidgetData };

export type CopilotWidgetKind = CopilotWidget['kind'];
