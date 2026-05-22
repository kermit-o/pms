/**
 * Sprint 13 — Copilot widgets (Mockup B, first slice).
 *
 * Cuando el agentic loop ejecuta un tool read-only que devuelve datos
 * estructurados (disponibilidad, ficha de reserva, folio…), en lugar
 * de depender del LLM para reformatearlos al usuario — el adapter los
 * convierte directamente a un `CopilotWidget` tipado que la UI sabe
 * pintar como tarjetas. Garantía por diseño: el precio que ve el
 * recepcionista es exactamente el que devolvió el tool, no una
 * paráfrasis del LLM.
 *
 * Este módulo es puro: sólo conversión + validación. Sin I/O.
 */

export type CopilotWidget =
  | { kind: 'availability'; data: AvailabilityWidgetData }
  | { kind: 'folio'; data: FolioWidgetData }
  | { kind: 'reservation'; data: ReservationWidgetData }
  | { kind: 'hsk_tasks'; data: HskTasksWidgetData };

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
  /** Conteo por status — útil para el resumen del LLM. */
  counts: {
    PENDING: number;
    IN_PROGRESS: number;
    DONE: number;
    BLOCKED: number;
  };
}

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

export interface AvailabilityWidgetData {
  arrival: string;
  departure: string;
  nights: number;
  rows: AvailabilityRow[];
}

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

/**
 * Convierte el resultado de un tool read-only en un widget, si el tool
 * y la forma del resultado coinciden con un widget conocido. Devuelve
 * null cuando:
 *   - el tool no tiene widget asociado;
 *   - el resultado no cumple la forma esperada (defensa contra cambios
 *     futuros del tool sin actualizar este módulo).
 *
 * Nunca lanza — si algo está mal, devuelve null y el adapter cae al
 * comportamiento anterior (texto del LLM).
 */
export function extractWidgetFromTool(
  toolName: string,
  toolInput: unknown,
  toolResult: unknown,
): CopilotWidget | null {
  switch (toolName) {
    case 'search_availability_by_type':
      return buildAvailabilityWidget(toolInput, toolResult);
    case 'get_folio':
      return buildFolioWidget(toolResult);
    case 'get_reservation':
      return buildReservationWidget(toolResult);
    case 'hsk_list_today':
      return buildHskTasksWidget(toolInput, toolResult);
    default:
      return null;
  }
}

function buildAvailabilityWidget(
  toolInput: unknown,
  toolResult: unknown,
): CopilotWidget | null {
  if (!Array.isArray(toolResult)) return null;
  const input = toolInput as Record<string, unknown> | null | undefined;
  const arrival = typeof input?.arrival === 'string' ? input.arrival : '';
  const departure = typeof input?.departure === 'string' ? input.departure : '';
  if (!arrival || !departure) return null;

  const rows: AvailabilityRow[] = [];
  for (const raw of toolResult) {
    const row = raw as Record<string, unknown>;
    if (
      typeof row.roomTypeId !== 'string' ||
      typeof row.code !== 'string' ||
      typeof row.name !== 'string' ||
      typeof row.maxOccupancy !== 'number' ||
      typeof row.availableRooms !== 'number' ||
      typeof row.totalRooms !== 'number' ||
      typeof row.pricePerNight !== 'string' ||
      typeof row.totalForStay !== 'string' ||
      typeof row.nights !== 'number'
    ) {
      // Defensa: si el resultado del tool no es lo esperado, abortamos
      // el widget entero. Mejor caer al texto del LLM que enseñar una
      // tarjeta con huecos.
      return null;
    }
    rows.push({
      roomTypeId: row.roomTypeId,
      code: row.code,
      name: row.name,
      description: typeof row.description === 'string' ? row.description : null,
      maxOccupancy: row.maxOccupancy,
      available: row.availableRooms,
      totalRooms: row.totalRooms,
      pricePerNight: row.pricePerNight,
      totalForStay: row.totalForStay,
      currency: typeof row.defaultCurrency === 'string' ? row.defaultCurrency : 'EUR',
    });
  }
  if (rows.length === 0) return null;
  const firstRaw = toolResult[0] as { nights: number };
  return {
    kind: 'availability',
    data: {
      arrival,
      departure,
      nights: firstRaw.nights,
      rows,
    },
  };
}

function buildFolioWidget(toolResult: unknown): CopilotWidget | null {
  if (!toolResult || typeof toolResult !== 'object') return null;
  const r = toolResult as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.reservationId !== 'string' ||
    typeof r.reservationCode !== 'string' ||
    typeof r.status !== 'string' ||
    typeof r.balance !== 'string' ||
    typeof r.currency !== 'string' ||
    !Array.isArray(r.entries)
  ) {
    return null;
  }
  const entries: FolioEntry[] = [];
  for (const raw of r.entries) {
    const e = raw as Record<string, unknown>;
    if (
      typeof e.id !== 'string' ||
      typeof e.type !== 'string' ||
      typeof e.description !== 'string' ||
      typeof e.amount !== 'string' ||
      typeof e.currency !== 'string' ||
      typeof e.postedAt !== 'string'
    ) {
      return null;
    }
    entries.push({
      id: e.id,
      type: e.type,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      postedAt: e.postedAt,
    });
  }
  return {
    kind: 'folio',
    data: {
      folioId: r.id,
      reservationId: r.reservationId,
      reservationCode: r.reservationCode,
      status: r.status,
      balance: r.balance,
      currency: r.currency,
      entries,
    },
  };
}

function buildReservationWidget(toolResult: unknown): CopilotWidget | null {
  if (!toolResult || typeof toolResult !== 'object') return null;
  const r = toolResult as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.code !== 'string' ||
    typeof r.status !== 'string' ||
    typeof r.arrivalDate !== 'string' ||
    typeof r.departureDate !== 'string' ||
    typeof r.totalAmount !== 'string' ||
    typeof r.currency !== 'string' ||
    typeof r.adults !== 'number' ||
    typeof r.roomTypeCode !== 'string' ||
    typeof r.roomTypeName !== 'string'
  ) {
    return null;
  }
  // Calculamos nights desde las fechas (las date strings ya vienen
  // serializadas como ISO de toDetail()).
  const arrival = new Date(r.arrivalDate);
  const departure = new Date(r.departureDate);
  const nights = Math.max(
    1,
    Math.round((departure.getTime() - arrival.getTime()) / 86_400_000),
  );

  // Primary guest del array `guests` (lo serializa toDetail).
  let primaryGuest: ReservationWidgetData['guest'] = null;
  if (Array.isArray(r.guests)) {
    const primary = (r.guests as Array<Record<string, unknown>>).find(
      (g) => g.isPrimary === true,
    );
    const g = primary?.guest as Record<string, unknown> | undefined;
    if (g && typeof g.firstName === 'string' && typeof g.lastName === 'string') {
      primaryGuest = {
        firstName: g.firstName,
        lastName: g.lastName,
        email: typeof g.email === 'string' ? g.email : null,
        phone: typeof g.phone === 'string' ? g.phone : null,
      };
    }
  }

  let folio: ReservationWidgetData['folio'] = null;
  if (r.folio && typeof r.folio === 'object') {
    const f = r.folio as Record<string, unknown>;
    if (
      typeof f.id === 'string' &&
      typeof f.status === 'string' &&
      typeof f.balance === 'string' &&
      typeof f.currency === 'string'
    ) {
      folio = { id: f.id, status: f.status, balance: f.balance, currency: f.currency };
    }
  }

  return {
    kind: 'reservation',
    data: {
      reservationId: r.id,
      reservationCode: r.code,
      status: r.status,
      arrival: r.arrivalDate.slice(0, 10),
      departure: r.departureDate.slice(0, 10),
      nights,
      adults: r.adults,
      children: typeof r.children === 'number' ? r.children : 0,
      totalAmount: r.totalAmount,
      currency: r.currency,
      roomTypeCode: r.roomTypeCode,
      roomTypeName: r.roomTypeName,
      roomNumber: typeof r.roomNumber === 'string' ? r.roomNumber : null,
      guest: primaryGuest,
      guaranteeStatus: typeof r.guaranteeStatus === 'string' ? r.guaranteeStatus : 'PENDING',
      guaranteeType: typeof r.guaranteeType === 'string' ? r.guaranteeType : 'NONE',
      cardBrand: typeof r.stripeCardBrand === 'string' ? r.stripeCardBrand : null,
      cardLast4: typeof r.stripeCardLast4 === 'string' ? r.stripeCardLast4 : null,
      folio,
    },
  };
}

function buildHskTasksWidget(
  toolInput: unknown,
  toolResult: unknown,
): CopilotWidget | null {
  if (!Array.isArray(toolResult)) return null;
  const inputDate =
    typeof (toolInput as Record<string, unknown>)?.businessDate === 'string'
      ? ((toolInput as { businessDate: string }).businessDate)
      : new Date().toISOString().slice(0, 10);

  const rows: HskTaskRow[] = [];
  const counts = { PENDING: 0, IN_PROGRESS: 0, DONE: 0, BLOCKED: 0 };
  for (const raw of toolResult) {
    const r = raw as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      typeof r.taskType !== 'string' ||
      typeof r.status !== 'string'
    ) {
      return null;
    }
    rows.push({
      id: r.id,
      roomNumber: typeof r.roomNumber === 'string' ? r.roomNumber : null,
      roomFloor: typeof r.roomFloor === 'string' ? r.roomFloor : null,
      taskType: r.taskType,
      status: r.status,
      assigneeName: typeof r.assigneeName === 'string' ? r.assigneeName : null,
      startedAt: typeof r.startedAt === 'string' ? r.startedAt : null,
      completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
      durationMin: typeof r.durationMin === 'number' ? r.durationMin : null,
      notes: typeof r.notes === 'string' ? r.notes : null,
    });
    if (r.status === 'PENDING') counts.PENDING += 1;
    else if (r.status === 'IN_PROGRESS') counts.IN_PROGRESS += 1;
    else if (r.status === 'DONE') counts.DONE += 1;
    else if (r.status === 'BLOCKED') counts.BLOCKED += 1;
  }
  return {
    kind: 'hsk_tasks',
    data: {
      businessDate: inputDate,
      rows,
      counts,
    },
  };
}
