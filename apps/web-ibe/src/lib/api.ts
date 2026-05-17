/**
 * Cliente del API público IBE (Sprint 8 W2).
 *
 * Sin auth — todas las llamadas a `/public/ibe/*` pasan tal cual. El
 * server component fetchea desde el server (no expone CORS al cliente).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class IbeApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`IBE API ${status}: ${body}`);
  }
}

export interface IbeProperty {
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  locale: string;
}

export interface IbeRoomTypeAvailability {
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

export interface IbeAvailabilityResponse {
  property: IbeProperty;
  results: IbeRoomTypeAvailability[];
}

export interface IbeReservationView {
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

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new IbeApiError(res.status, await res.text());
  return (await res.json()) as T;
}

export async function getProperty(slug: string): Promise<IbeProperty> {
  return fetchJson(`/public/ibe/properties/${encodeURIComponent(slug)}`);
}

export async function searchAvailability(
  slug: string,
  query: { arrival: string; departure: string; adults: number; children: number },
): Promise<IbeAvailabilityResponse> {
  const qs = new URLSearchParams({
    arrival: query.arrival,
    departure: query.departure,
    adults: String(query.adults),
    children: String(query.children),
  });
  return fetchJson(
    `/public/ibe/properties/${encodeURIComponent(slug)}/availability?${qs.toString()}`,
  );
}

export async function getReservation(
  slug: string,
  code: string,
  lastName: string,
): Promise<IbeReservationView> {
  const qs = new URLSearchParams({ lastName });
  return fetchJson(
    `/public/ibe/properties/${encodeURIComponent(slug)}/reservations/${encodeURIComponent(code)}?${qs.toString()}`,
  );
}

export interface CreateReservationInput {
  arrival: string;
  departure: string;
  roomTypeId: string;
  occupancy: { adults: number; children: number };
  guest: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    nationality?: string;
    gdprConsent: true;
    marketingConsent: boolean;
  };
  specialRequests?: string;
}

export interface CreateReservationResult {
  code: string;
  status: string;
  arrival: string;
  departure: string;
  totalAmount: string;
  currency: string;
}

export async function createReservation(
  slug: string,
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  return fetchJson(`/public/ibe/properties/${encodeURIComponent(slug)}/reservations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function publicSetupIntent(
  slug: string,
  code: string,
  lastName: string,
): Promise<{ clientSecret: string; publishableKey: string }> {
  return fetchJson(
    `/public/ibe/properties/${encodeURIComponent(slug)}/reservations/${encodeURIComponent(code)}/setup-intent`,
    {
      method: 'POST',
      body: JSON.stringify({ lastName }),
    },
  );
}

export async function publicConfirmSetupIntent(
  slug: string,
  code: string,
  lastName: string,
): Promise<{ status: string; brand: string | null; last4: string | null }> {
  return fetchJson(
    `/public/ibe/properties/${encodeURIComponent(slug)}/reservations/${encodeURIComponent(code)}/confirm-setup-intent`,
    {
      method: 'POST',
      body: JSON.stringify({ lastName }),
    },
  );
}

export interface CancelResult {
  code: string;
  status: 'CANCELLED';
  penalty: string;
  currency: string;
  policy: string | null;
}

export async function cancelReservation(
  slug: string,
  code: string,
  lastName: string,
  acceptPenalty: boolean,
): Promise<CancelResult> {
  return fetchJson(
    `/public/ibe/properties/${encodeURIComponent(slug)}/reservations/${encodeURIComponent(code)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ lastName, acceptPenalty }),
    },
  );
}

export async function resendConfirmation(
  slug: string,
  code: string,
  lastName: string,
): Promise<{ queued: true; email: string | null }> {
  return fetchJson(
    `/public/ibe/properties/${encodeURIComponent(slug)}/reservations/${encodeURIComponent(code)}/resend-confirmation`,
    {
      method: 'POST',
      body: JSON.stringify({ lastName }),
    },
  );
}
