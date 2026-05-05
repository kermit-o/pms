/**
 * Thin REST client for the Aubergine API. The access token from the
 * NextAuth session is forwarded as a Bearer for the API to validate via
 * Keycloak JWKS.
 *
 * Real KPIs land in S2-W5 once availability/business-day endpoints exist;
 * for now this returns placeholders so the dashboard renders end-to-end.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface DashboardKpis {
  arrivalsToday: number;
  departuresToday: number;
  inHouse: number;
  occupancyPct: number;
}

export async function fetchDashboardKpis(
  _accessToken: string | undefined,
): Promise<DashboardKpis> {
  return {
    arrivalsToday: 0,
    departuresToday: 0,
    inHouse: 0,
    occupancyPct: 0,
  };
}

interface ApiInit extends RequestInit {
  accessToken?: string;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: ApiInit = {},
): Promise<T> {
  const { accessToken, headers, ...rest } = init;
  const merged: HeadersInit = {
    'content-type': 'application/json',
    ...(headers ?? {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: merged,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API ${status}: ${body || '<empty>'}`);
    this.name = 'ApiError';
  }
}

export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface ReservationListItem {
  id: string;
  code: string;
  status: ReservationStatus;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  roomTypeId: string;
  roomId: string | null;
  totalAmount: string;
  currency: string;
}

export interface CreateReservationInput {
  propertyId: string;
  guestId?: string;
  guestData?: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    nationality?: string;
  };
  arrival: string;
  departure: string;
  roomTypeId: string;
  ratePlanId?: string;
  occupancy: { adults: number; children?: number };
  totalAmount?: number;
  currency?: string;
  specialRequests?: string;
  notes?: string;
}

export async function listReservations(
  accessToken: string | undefined,
  query: { from?: string; to?: string; status?: ReservationStatus; limit?: number } = {},
): Promise<{ items: ReservationListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.status) params.set('status', query.status);
  if (query.limit) params.set('limit', String(query.limit));
  const q = params.toString();
  return apiFetch(`/reservations${q ? `?${q}` : ''}`, { accessToken });
}

export async function createReservation(
  accessToken: string | undefined,
  input: CreateReservationInput & { walkIn?: boolean },
): Promise<{ id: string; code: string }> {
  const path = input.walkIn ? '/reservations/walk-in' : '/reservations';
  return apiFetch(path, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function cancelReservation(
  accessToken: string | undefined,
  id: string,
  reason: string,
): Promise<{ id: string }> {
  return apiFetch(`/reservations/${id}`, {
    method: 'DELETE',
    accessToken,
    body: JSON.stringify({ reason }),
  });
}
