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
  | { kind: 'folio'; data: FolioWidgetData };

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
