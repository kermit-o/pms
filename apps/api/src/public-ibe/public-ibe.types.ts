/**
 * Tipos compartidos del API público IBE (Sprint 8 W1).
 *
 * Lo que se expone aquí cruza al cliente sin auth — cualquier campo
 * sensible (tenantId, internal codes, totales internos) NO debe
 * aparecer en estos tipos.
 */

export interface PublicProperty {
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  locale: string;
}

/**
 * Sprint 13 W1 — Una `PublicRateOption` por (roomType × ratePlan público).
 * Si la propiedad no tiene rate plans configurados, el IBE genera una
 * única opción virtual "flexible" basada en RoomType.defaultRate para
 * mantener retro-compat con la UI previa.
 */
export interface PublicRateOption {
  ratePlanId: string | null;
  code: string;
  name: string;
  description: string | null;
  nonRefundable: boolean;
  discountPct: number | null;
  pricePerNight: string;
  totalForStay: string;
  currency: string;
  /** Si true, la creación de reserva con este plan exige paymentMode=charge. */
  requiresPrepayment: boolean;
}

export interface PublicRoomTypeAvailability {
  roomTypeId: string;
  code: string;
  name: string;
  available: number;
  totalRooms: number;
  maxOccupancy: number;
  nights: number;
  /** Tarifa más barata, para mostrarla en cabecera del card. */
  pricePerNight: string;
  totalForStay: string;
  currency: string;
  /** Sprint 13 W1 — todas las tarifas disponibles para este roomType. */
  rates: PublicRateOption[];
}

export interface PublicReservationCreateResult {
  code: string;
  status: string;
  arrival: string;
  departure: string;
  totalAmount: string;
  currency: string;
  /** 'setup' = card guarantee; 'charge' = pre-pago non-refundable. */
  paymentMode: 'setup' | 'charge';
}

export interface PublicReservationView {
  code: string;
  status: string;
  arrival: string;
  departure: string;
  totalAmount: string;
  currency: string;
  roomType: { code: string; name: string };
  guest: { firstName: string; lastName: string; email: string | null };
  cancellable: boolean;
  cancellationPolicy: string | null;
}

export interface PublicCancelResult {
  code: string;
  status: 'CANCELLED';
  penalty: string;
  currency: string;
  policy: string | null;
}
