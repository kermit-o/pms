import type { ReservationSource } from '@pms/db';

/**
 * Tipos comunes del módulo channel-manager (Sprint 9 W2).
 */

export interface PushAvailabilityItem {
  roomTypeCode: string;
  date: string; // YYYY-MM-DD
  available: number;
}

export interface PushRateItem {
  roomTypeCode: string;
  ratePlanCode: string;
  date: string; // YYYY-MM-DD
  amount: string; // decimal as string
  currency: string;
}

export interface InboundReservationParsed {
  /** Identificador del provider para esta reserva. Idempotency key. */
  externalRef: string;
  source: ReservationSource;
  arrival: string; // YYYY-MM-DD
  departure: string; // YYYY-MM-DD
  adults: number;
  children: number;
  /** RoomType code en el catálogo del hotel (no del provider). */
  roomTypeCode: string;
  totalAmount: string;
  currency: string;
  guest: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    nationality: string | null;
  };
  specialRequests: string | null;
}

export interface ChannelManagerProvider {
  /** Identificador del provider (ej. "siteminder"). */
  readonly id: string;
  /**
   * Verifica la firma HMAC del webhook entrante. Si la verificación falla
   * o no aplica para este provider (ningún cuerpo), devolver `false` para
   * que el controller responda 401.
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | undefined>,
    secret: string,
  ): boolean;
  /** Convierte el cuerpo recibido a la forma canónica del PMS. */
  parseInboundReservation(rawBody: string): InboundReservationParsed;
  /** Hace push de disponibilidad. Devuelve `{ pushed, skipped }`. */
  pushAvailability(input: {
    apiBase: string;
    apiKey: string;
    cmPropertyId: string;
    items: PushAvailabilityItem[];
  }): Promise<{ pushed: number; skipped: number }>;
  /** Hace push de tarifas. */
  pushRates(input: {
    apiBase: string;
    apiKey: string;
    cmPropertyId: string;
    items: PushRateItem[];
  }): Promise<{ pushed: number; skipped: number }>;
}
