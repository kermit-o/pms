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

export interface PublicRoomTypeAvailability {
  roomTypeId: string;
  code: string;
  name: string;
  available: number;
  totalRooms: number;
  maxOccupancy: number;
  pricePerNight: string;
  totalForStay: string;
  currency: string;
  nights: number;
}

export interface PublicReservationCreateResult {
  code: string;
  status: string;
  arrival: string;
  departure: string;
  totalAmount: string;
  currency: string;
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
