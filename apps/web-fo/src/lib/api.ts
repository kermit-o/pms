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

// ---------------------------------------------------------------------------
// Folio
// ---------------------------------------------------------------------------

export interface FolioEntry {
  id: string;
  type: 'CHARGE' | 'PAYMENT' | 'DISCOUNT' | 'TAX' | 'ADJUSTMENT';
  description: string;
  amount: string;
  currency: string;
  postedAt: string;
  postedBy: string | null;
  attributes: unknown;
}

export interface FolioDetail {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
  balance: string;
  currency: string;
  closedAt: string | null;
  reservationId: string;
  createdAt: string;
  updatedAt: string;
  entries: FolioEntry[];
}

export async function getFolio(
  accessToken: string | undefined,
  folioId: string,
): Promise<FolioDetail> {
  return apiFetch(`/folios/${folioId}`, { accessToken });
}

export async function addFolioCharge(
  accessToken: string | undefined,
  folioId: string,
  input: {
    description: string;
    amount: number;
    type?: 'CHARGE' | 'TAX';
    idempotencyKey?: string;
  },
): Promise<{ entryId: string; balance: string }> {
  return apiFetch(`/folios/${folioId}/charges`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function addFolioPayment(
  accessToken: string | undefined,
  folioId: string,
  input: {
    description: string;
    amount: number;
    paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
    reference?: string;
    idempotencyKey?: string;
  },
): Promise<{ entryId: string; balance: string }> {
  return apiFetch(`/folios/${folioId}/payments`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function closeFolio(
  accessToken: string | undefined,
  folioId: string,
): Promise<{ id: string }> {
  return apiFetch(`/folios/${folioId}/close`, {
    method: 'POST',
    accessToken,
  });
}

// ---------------------------------------------------------------------------
// Guests / Cardex
// ---------------------------------------------------------------------------

export interface GuestListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  documentType: string | null;
  documentNumber: string | null;
  nationality: string | null;
  createdAt: string;
}

export type GuestDetail = GuestListItem & {
  dateOfBirth: string | null;
  documentIssuingCountry: string | null;
  documentExpiryDate: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  country: string | null;
  gdprConsent: boolean;
  marketingConsent: boolean;
  notes: string | null;
  updatedAt: string;
};

export async function listGuests(
  accessToken: string | undefined,
  query: { q?: string; limit?: number } = {},
): Promise<{ items: GuestListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.limit) params.set('limit', String(query.limit));
  const q = params.toString();
  return apiFetch(`/guests${q ? `?${q}` : ''}`, { accessToken });
}

export async function getGuest(
  accessToken: string | undefined,
  id: string,
): Promise<GuestDetail> {
  return apiFetch(`/guests/${id}`, { accessToken });
}

export async function patchGuest(
  accessToken: string | undefined,
  id: string,
  input: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    nationality: string;
    documentType: 'DNI' | 'NIE' | 'PASSPORT' | 'EU_ID' | 'OTHER';
    documentNumber: string;
    addressLine1: string;
    city: string;
    postalCode: string;
    country: string;
    gdprConsent: boolean;
    marketingConsent: boolean;
    notes: string;
  }>,
): Promise<{ id: string }> {
  return apiFetch(`/guests/${id}`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function getGuestAccessExport(
  accessToken: string | undefined,
  id: string,
): Promise<unknown> {
  return apiFetch(`/guests/${id}/access-export`, { accessToken });
}

export async function eraseGuest(
  accessToken: string | undefined,
  id: string,
  reason: string,
  hard = false,
): Promise<{ id: string; hard: boolean }> {
  return apiFetch(`/guests/${id}/erase`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ reason, hard }),
  });
}
