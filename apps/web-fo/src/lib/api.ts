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
  accessToken: string | undefined,
  propertyId?: string,
): Promise<DashboardKpis> {
  if (!accessToken || !propertyId) {
    return { arrivalsToday: 0, departuresToday: 0, inHouse: 0, occupancyPct: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  // Ventana ±1 dia para capturar tanto in-house como llegadas/salidas de hoy.
  // El filtro de la API es departureDate>from AND arrivalDate<to (estricto).
  const [reservations, rooms] = await Promise.all([
    listReservations(accessToken, { from: yesterday, to: tomorrow, limit: 200 }),
    listRooms(accessToken, { propertyId }),
  ]);

  const items = reservations.items;
  const arrivalsToday = items.filter(
    (r) =>
      r.arrivalDate === today &&
      (r.status === 'CONFIRMED' || r.status === 'PENDING' || r.status === 'CHECKED_IN'),
  ).length;
  const departuresToday = items.filter(
    (r) =>
      r.departureDate === today &&
      (r.status === 'CHECKED_IN' || r.status === 'CHECKED_OUT'),
  ).length;
  const inHouse = items.filter((r) => r.status === 'CHECKED_IN').length;
  const totalRooms = rooms.filter((r) => !r.isOutOfOrder).length || 1;
  const occupancyPct = Math.round((inHouse / totalRooms) * 100);

  return { arrivalsToday, departuresToday, inHouse, occupancyPct };
}

interface ApiInit extends RequestInit {
  accessToken?: string;
}

export async function apiFetch<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
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
  walkIn?: boolean;
  guarantee?: {
    type: 'NONE' | 'CARD_ON_FILE' | 'DEPOSIT' | 'CORPORATE' | 'HOTEL_GUARANTEE';
    amount?: number;
    reference?: string;
    cancellationPolicyId?: string;
  };
}

export interface ReservationGroupDetail {
  id: string;
  code: string;
  name: string;
  organizerName: string | null;
  organizerEmail: string | null;
  organizerPhone: string | null;
  notes: string | null;
  propertyId: string;
  createdAt: string;
  updatedAt: string;
  reservations: Array<ReservationListItem & { roomNumber: string | null; roomFloor: string | null }>;
}

export async function getReservationGroup(
  accessToken: string | undefined,
  id: string,
): Promise<ReservationGroupDetail> {
  return apiFetch(`/reservations/groups/${id}`, { accessToken });
}

export async function patchReservationGroup(
  accessToken: string | undefined,
  id: string,
  input: {
    name?: string;
    organizerName?: string;
    organizerEmail?: string;
    organizerPhone?: string;
    notes?: string;
    arrival?: string;
    departure?: string;
    roomTypeId?: string;
    ratePlanId?: string;
  },
): Promise<{ id: string; affectedReservations: number }> {
  return apiFetch(`/reservations/groups/${id}`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function cancelReservationGroup(
  accessToken: string | undefined,
  id: string,
  reason: string,
): Promise<{ id: string; cancelledReservations: number }> {
  return apiFetch(`/reservations/groups/${id}/cancel`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ reason }),
  });
}

export async function bulkAssignRooms(
  accessToken: string | undefined,
  id: string,
): Promise<{ id: string; assignedCount: number; missingByType: Record<string, number> }> {
  return apiFetch(`/reservations/groups/${id}/bulk-assign-rooms`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({}),
  });
}

export async function bulkCheckIn(
  accessToken: string | undefined,
  id: string,
): Promise<{ id: string; checkedIn: number; skipped: Array<{ id: string; reason: string }> }> {
  return apiFetch(`/reservations/groups/${id}/bulk-check-in`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({}),
  });
}

export async function bulkCheckOut(
  accessToken: string | undefined,
  id: string,
): Promise<{ id: string; checkedOut: number; skipped: Array<{ id: string; reason: string }> }> {
  return apiFetch(`/reservations/groups/${id}/bulk-check-out`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({}),
  });
}

export async function createStripeSetupIntent(
  accessToken: string | undefined,
  reservationId: string,
): Promise<{ clientSecret: string; publishableKey: string }> {
  return apiFetch(`/payments/stripe/reservations/${reservationId}/setup-intent`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({}),
  });
}

export interface NoShowChargeResult {
  status: 'succeeded' | 'requires_action' | 'already_charged' | 'failed';
  paymentIntentId: string | null;
  folioEntryId: string | null;
  error?: string;
}

export async function chargeNoShow(
  accessToken: string | undefined,
  reservationId: string,
  amount: number,
  description?: string,
): Promise<NoShowChargeResult> {
  return apiFetch(`/payments/stripe/reservations/${reservationId}/charge-no-show`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ amount, description }),
  });
}

export async function updateGuarantee(
  accessToken: string | undefined,
  reservationId: string,
  input: {
    type?: 'NONE' | 'CARD_ON_FILE' | 'DEPOSIT' | 'CORPORATE' | 'HOTEL_GUARANTEE';
    status?: 'PENDING' | 'SECURED' | 'EXPIRED' | 'FAILED' | 'RELEASED';
    amount?: number;
    reference?: string;
  },
): Promise<{ id: string; guaranteeStatus: string; guaranteeType: string }> {
  return apiFetch(`/reservations/${reservationId}/guarantee`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export interface ReservationRichListItem extends ReservationListItem {
  source: string;
  ratePlanId: string | null;
  ratePlanCode: string | null;
  groupId: string | null;
  groupCode: string | null;
  groupName: string | null;
  organizerName: string | null;
  guaranteeStatus: 'PENDING' | 'SECURED' | 'EXPIRED' | 'FAILED' | 'RELEASED';
  agencyName: string | null;
  companyName: string | null;
  roomNumber: string | null;
  roomFloor: string | null;
  roomTypeCode: string | null;
  roomTypeName: string | null;
  primaryGuest: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    membershipLevel: string | null;
  } | null;
  folioBalance: string | null;
}

export interface ListReservationsQuery {
  from?: string;
  to?: string;
  arrivalFrom?: string;
  arrivalTo?: string;
  departureFrom?: string;
  departureTo?: string;
  /** Coma-separados, ej. "PENDING,CONFIRMED" */
  status?: string;
  source?: string;
  groupId?: string;
  search?: string;
  guaranteeStatus?: string;
  /** "true" → solo reservas sin roomId */
  unassigned?: string;
  cursor?: string;
  limit?: number;
}

export async function listReservations(
  accessToken: string | undefined,
  query: ListReservationsQuery = {},
): Promise<{ items: ReservationRichListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
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

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export interface PropertySummary {
  id: string;
  code: string;
  name: string;
  timezone: string;
  currency: string;
  locale: string;
}

export async function listProperties(
  accessToken: string | undefined,
): Promise<PropertySummary[]> {
  return apiFetch(`/properties`, { accessToken });
}

// ---------------------------------------------------------------------------
// Availability search (alimenta el wizard de creación)
// ---------------------------------------------------------------------------

export interface RoomTypeAvailability {
  roomTypeId: string;
  code: string;
  name: string;
  description: string | null;
  baseOccupancy: number;
  maxOccupancy: number;
  totalRooms: number;
  availableRooms: number;
  pricePerNight: string;
  nights: number;
  totalForStay: string;
  currency: string;
}

export async function searchAvailabilityByType(
  accessToken: string | undefined,
  query: { propertyId: string; arrival: string; departure: string; ratePlanId?: string },
): Promise<RoomTypeAvailability[]> {
  const params = new URLSearchParams({
    propertyId: query.propertyId,
    arrival: query.arrival,
    departure: query.departure,
  });
  if (query.ratePlanId) params.set('ratePlanId', query.ratePlanId);
  return apiFetch(`/rooms/availability/by-type?${params.toString()}`, { accessToken });
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

export async function assignRoom(
  accessToken: string | undefined,
  reservationId: string,
  roomId: string,
): Promise<{ id: string; roomId: string }> {
  return apiFetch(`/reservations/${reservationId}/assign-room`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ roomId }),
  });
}

export async function checkOutReservation(
  accessToken: string | undefined,
  reservationId: string,
): Promise<{ id: string; balance: number }> {
  return apiFetch(`/reservations/${reservationId}/check-out`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({}),
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

export async function getGuest(accessToken: string | undefined, id: string): Promise<GuestDetail> {
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

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type RoomStatus = 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE';

export interface RoomListItem {
  id: string;
  number: string;
  floor: string | null;
  status: string;
  isOutOfOrder: boolean;
  outOfOrderReason: string | null;
  roomTypeId: string;
  propertyId: string;
}

export interface AvailabilityCell {
  state: string;
  reservation: {
    id: string;
    code: string;
    status: string;
    arrivalDate: string;
    departureDate: string;
  } | null;
}

export interface AvailabilityMatrix {
  from: string;
  to: string;
  days: string[];
  rooms: RoomListItem[];
  cells: Record<string, Record<string, AvailabilityCell>>;
}

export async function listRooms(
  accessToken: string | undefined,
  query: { propertyId?: string; status?: RoomStatus; floor?: string } = {},
): Promise<RoomListItem[]> {
  const params = new URLSearchParams();
  if (query.propertyId) params.set('propertyId', query.propertyId);
  if (query.status) params.set('status', query.status);
  if (query.floor) params.set('floor', query.floor);
  const q = params.toString();
  return apiFetch(`/rooms${q ? `?${q}` : ''}`, { accessToken });
}

export async function getRoomAvailability(
  accessToken: string | undefined,
  query: { propertyId: string; from: string; to: string; roomTypeId?: string },
): Promise<AvailabilityMatrix> {
  const params = new URLSearchParams({
    propertyId: query.propertyId,
    from: query.from,
    to: query.to,
  });
  if (query.roomTypeId) params.set('roomTypeId', query.roomTypeId);
  return apiFetch(`/rooms/availability?${params.toString()}`, { accessToken });
}

export async function changeRoomStatus(
  accessToken: string | undefined,
  roomId: string,
  status: RoomStatus,
  outOfOrderReason?: string,
): Promise<{ id: string; status: string }> {
  return apiFetch(`/rooms/${roomId}/status`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ status, outOfOrderReason }),
  });
}

// ---------------------------------------------------------------------------
// Business day
// ---------------------------------------------------------------------------

export interface BusinessDayState {
  propertyId: string;
  businessDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  closedByUserId: string | null;
  reopenedAt: string | null;
  reopenedReason: string | null;
}

export async function getBusinessDayState(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<BusinessDayState> {
  const params = new URLSearchParams({ propertyId, businessDate });
  return apiFetch(`/business-day/state?${params.toString()}`, { accessToken });
}

export async function listBusinessDays(
  accessToken: string | undefined,
  propertyId: string,
  range?: { from?: string; to?: string },
): Promise<BusinessDayState[]> {
  const params = new URLSearchParams({ propertyId });
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  return apiFetch(`/business-day?${params.toString()}`, { accessToken });
}

export async function closeBusinessDay(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<{ propertyId: string; businessDate: string }> {
  return apiFetch('/business-day/close', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ propertyId, businessDate }),
  });
}

export async function reopenBusinessDay(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
  reason: string,
): Promise<{ propertyId: string; businessDate: string }> {
  return apiFetch('/business-day/reopen', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ propertyId, businessDate, reason }),
  });
}

// ---------------------------------------------------------------------------
// SES.HOSPEDAJES
// ---------------------------------------------------------------------------

export type SesSubmissionStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'DEAD_LETTER';

export interface SesSubmission {
  id: string;
  propertyId: string;
  businessDate: string;
  status: SesSubmissionStatus;
  submittedAt: string | null;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SesSubmissionDetail = SesSubmission & {
  xmlPayload: string | null;
  xmlSignature: string | null;
  responseCode: number | null;
  responseBody: string | null;
};

export async function listSesSubmissions(
  accessToken: string | undefined,
  query: {
    propertyId?: string;
    status?: SesSubmissionStatus;
    from?: string;
    to?: string;
  } = {},
): Promise<SesSubmission[]> {
  const params = new URLSearchParams();
  if (query.propertyId) params.set('propertyId', query.propertyId);
  if (query.status) params.set('status', query.status);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const q = params.toString();
  return apiFetch(`/compliance/ses-hospedajes/submissions${q ? `?${q}` : ''}`, { accessToken });
}

export async function getSesSubmission(
  accessToken: string | undefined,
  id: string,
): Promise<SesSubmissionDetail> {
  return apiFetch(`/compliance/ses-hospedajes/submissions/${id}`, {
    accessToken,
  });
}

export async function queueSesSubmission(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<{ submissionId: string; xmlPayload: string; guestCount: number }> {
  return apiFetch('/compliance/ses-hospedajes/submissions', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ propertyId, businessDate }),
  });
}

export async function sendSesSubmission(
  accessToken: string | undefined,
  id: string,
): Promise<{ submissionId: string; status: SesSubmissionStatus }> {
  return apiFetch(`/compliance/ses-hospedajes/submissions/${id}/send`, {
    method: 'POST',
    accessToken,
  });
}

// ---------------------------------------------------------------------------
// Copilot
// ---------------------------------------------------------------------------

export type FoToolName =
  | 'query_availability'
  | 'create_reservation'
  | 'check_in'
  | 'check_out'
  | 'add_folio_charge'
  | 'assign_room';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pendingToolId?: string;
  pendingTool?: {
    name: FoToolName;
    input: unknown;
    financial: boolean;
  };
  createdAt: string;
}

export interface CopilotPendingTool {
  id: string;
  tool: FoToolName;
  input: unknown;
  financial: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'failed';
  createdAt: string;
}

export interface CopilotSession {
  sessionId: string;
  propertyId: string | null;
  createdAt: string;
  messages: CopilotMessage[];
  pendingTools: CopilotPendingTool[];
}

export async function createCopilotSession(
  accessToken: string | undefined,
  propertyId?: string,
): Promise<{ sessionId: string }> {
  return apiFetch('/copilot/sessions', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(propertyId ? { propertyId } : {}),
  });
}

export async function getCopilotSession(
  accessToken: string | undefined,
  sessionId: string,
): Promise<CopilotSession> {
  return apiFetch(`/copilot/sessions/${sessionId}`, { accessToken });
}

export async function sendCopilotMessage(
  accessToken: string | undefined,
  sessionId: string,
  content: string,
): Promise<CopilotSession> {
  return apiFetch(`/copilot/sessions/${sessionId}/messages`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ content }),
  });
}

export async function confirmCopilotTool(
  accessToken: string | undefined,
  sessionId: string,
  pendingToolId: string,
  decision: 'approve' | 'reject',
): Promise<CopilotSession> {
  return apiFetch(`/copilot/sessions/${sessionId}/confirm-tool`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ pendingToolId, decision }),
  });
}

// ---------------------------------------------------------------------------
// Night Audit
// ---------------------------------------------------------------------------

export type NightAuditRunStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export type NightAuditStep =
  | 'POST_ROOM_CHARGES'
  | 'POST_TAXES'
  | 'POST_PACKAGES'
  | 'MARK_NO_SHOWS'
  | 'SNAPSHOT_REPORTS'
  | 'DETECT_ANOMALIES'
  | 'CLOSE_DAY';

export type NightAuditAnomalyKind =
  | 'DUPLICATE_CHARGE'
  | 'CASH_DRAWER_VARIANCE'
  | 'DEEP_DISCOUNT'
  | 'CANCELLATION_SPREE'
  | 'RATE_OVERRIDE';
export type NightAuditAnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface NightAuditAnomaly {
  id: string;
  propertyId: string;
  runId: string;
  businessDate: string;
  kind: NightAuditAnomalyKind;
  severity: NightAuditAnomalySeverity;
  details: unknown;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

export async function listNightAuditAnomalies(
  accessToken: string | undefined,
  query: {
    propertyId?: string;
    businessDate?: string;
    from?: string;
    to?: string;
    kind?: NightAuditAnomalyKind;
    severity?: NightAuditAnomalySeverity;
    reviewed?: 'yes' | 'no';
    limit?: number;
  } = {},
): Promise<NightAuditAnomaly[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const q = params.toString();
  return apiFetch(`/night-audit/anomalies${q ? `?${q}` : ''}`, { accessToken });
}

export async function reviewNightAuditAnomaly(
  accessToken: string | undefined,
  anomalyId: string,
  notes: string | undefined,
): Promise<NightAuditAnomaly> {
  return apiFetch(`/night-audit/anomalies/${anomalyId}/review`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify({ notes: notes ?? '' }),
  });
}

export type ForecastMetric = 'occupancy' | 'adr' | 'revpar' | 'pickup';

export interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  metric: ForecastMetric;
  horizon: number;
  modelFit: { alpha: number; beta: number };
  rmse: number | null;
  mape: number | null;
  series: ForecastPoint[];
  history: Array<{ date: string; value: number }>;
  message: string | null;
}

export async function getForecast(
  accessToken: string | undefined,
  query: { propertyId: string; horizon?: number; metric?: ForecastMetric },
): Promise<ForecastResult> {
  const params = new URLSearchParams({ propertyId: query.propertyId });
  if (query.horizon !== undefined) params.set('horizon', String(query.horizon));
  if (query.metric) params.set('metric', query.metric);
  return apiFetch(`/night-audit/forecast?${params.toString()}`, { accessToken });
}

export type NightAuditStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface NightAuditRunSummary {
  id: string;
  propertyId: string;
  businessDate: string;
  status: NightAuditRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  lastFailedStep: NightAuditStep | null;
  lastError: string | null;
  totals: Record<string, unknown>;
  steps: { step: NightAuditStep; status: NightAuditStepStatus }[];
}

export interface NightAuditState {
  propertyId: string;
  businessDate: string;
  run: NightAuditRunSummary | null;
}

export async function getNightAuditState(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<NightAuditState> {
  const params = new URLSearchParams({ propertyId, businessDate });
  return apiFetch(`/night-audit/state?${params.toString()}`, { accessToken });
}

export async function listNightAuditRuns(
  accessToken: string | undefined,
  query: {
    propertyId?: string;
    status?: NightAuditRunStatus;
    from?: string;
    to?: string;
  } = {},
): Promise<NightAuditRunSummary[]> {
  const params = new URLSearchParams();
  if (query.propertyId) params.set('propertyId', query.propertyId);
  if (query.status) params.set('status', query.status);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const q = params.toString();
  return apiFetch(`/night-audit/runs${q ? `?${q}` : ''}`, { accessToken });
}

export async function runNightAudit(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<NightAuditRunSummary> {
  return apiFetch('/night-audit/run', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ propertyId, businessDate }),
  });
}

export async function resumeNightAuditRun(
  accessToken: string | undefined,
  runId: string,
): Promise<NightAuditRunSummary> {
  return apiFetch(`/night-audit/runs/${runId}/resume`, {
    method: 'POST',
    accessToken,
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ManagerReport {
  businessDate: string;
  totalRooms: number;
  inHouse: number;
  arrivals: number;
  departures: number;
  cancellationsToday: number;
  occupancyPct: number;
  adr: string;
  revpar: string;
  charges: { count: number; totalAmount: string };
}

export interface RevenueReport {
  range: { from: string; to: string };
  rows: Array<{ type: string; count: number; totalAmount: string }>;
  totalAmount: string;
}

export interface TaxReport {
  range: { from: string; to: string };
  rows: Array<{ description: string; count: number; totalAmount: string }>;
  totalAmount: string;
}

export async function getManagerReport(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<ManagerReport> {
  const params = new URLSearchParams({ propertyId, businessDate });
  return apiFetch(`/reports/manager?${params.toString()}`, { accessToken });
}

export async function getRevenueReport(
  accessToken: string | undefined,
  propertyId: string,
  from: string,
  to: string,
): Promise<RevenueReport> {
  const params = new URLSearchParams({ propertyId, from, to });
  return apiFetch(`/reports/revenue?${params.toString()}`, { accessToken });
}

export async function getTaxReport(
  accessToken: string | undefined,
  propertyId: string,
  from: string,
  to: string,
): Promise<TaxReport> {
  const params = new URLSearchParams({ propertyId, from, to });
  return apiFetch(`/reports/tax?${params.toString()}`, { accessToken });
}

// W4 — In-house + Arrivals/Departures

export interface InHouseRow {
  reservationId: string;
  code: string;
  arrivalDate: string;
  departureDate: string;
  roomNumber: string | null;
  primaryGuest: string | null;
  adults: number;
  children: number;
  balance: string;
  currency: string;
}

export interface InHouseReport {
  businessDate: string;
  count: number;
  rows: InHouseRow[];
}

export interface ArrivalsDeparturesRow {
  reservationId: string;
  code: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  roomNumber: string | null;
  primaryGuest: string | null;
}

export interface ArrivalsDeparturesReport {
  businessDate: string;
  arrivals: ArrivalsDeparturesRow[];
  departures: ArrivalsDeparturesRow[];
}

export async function getInHouseReport(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<InHouseReport> {
  const params = new URLSearchParams({ propertyId, businessDate });
  return apiFetch(`/reports/in-house?${params.toString()}`, { accessToken });
}

export async function getArrivalsDeparturesReport(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<ArrivalsDeparturesReport> {
  const params = new URLSearchParams({ propertyId, businessDate });
  return apiFetch(`/reports/arrivals-departures?${params.toString()}`, {
    accessToken,
  });
}

// ---------------------------------------------------------------------------
// Cash drawer reconciliation
// ---------------------------------------------------------------------------

export interface CashReconciliation {
  id: string | null;
  propertyId: string;
  businessDate: string;
  currency: string;
  expectedAmount: string;
  countedAmount: string;
  discrepancy: string;
  toleranceCents: number;
  countedByUserId: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getCashReconciliation(
  accessToken: string | undefined,
  propertyId: string,
  businessDate: string,
): Promise<CashReconciliation> {
  const params = new URLSearchParams({ propertyId, businessDate });
  return apiFetch(`/cash/reconciliations?${params.toString()}`, { accessToken });
}

export async function upsertCashReconciliation(
  accessToken: string | undefined,
  input: {
    propertyId: string;
    businessDate: string;
    countedAmount: number;
    currency?: string;
    toleranceCents?: number;
    notes?: string;
  },
): Promise<CashReconciliation> {
  return apiFetch('/cash/reconciliations', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Sprint 10 W4 — Back-office admin de Property
// ---------------------------------------------------------------------------

export interface PropertySettings {
  id: string;
  code: string;
  name: string;
  ibe: { publishedAt: string | null; publicSlug: string | null };
  channelManager: {
    provider: 'siteminder' | null;
    channelManagerPropertyId: string | null;
    credentialsRef: string | null;
  };
  blockedIps: string[];
}

export async function getPropertySettings(
  accessToken: string,
  propertyId: string,
): Promise<PropertySettings> {
  return apiFetch(`/properties/${encodeURIComponent(propertyId)}/settings`, {
    accessToken,
  });
}

export async function setPropertyPublish(
  accessToken: string,
  propertyId: string,
  input: { publish: boolean; slug?: string },
): Promise<{ publishedAt: string | null; publicSlug: string | null }> {
  return apiFetch(`/properties/${encodeURIComponent(propertyId)}/publish`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function setPropertyChannelManager(
  accessToken: string,
  propertyId: string,
  input: {
    provider: 'siteminder' | null;
    channelManagerPropertyId: string | null;
    credentialsRef: string | null;
  },
): Promise<typeof input> {
  return apiFetch(`/properties/${encodeURIComponent(propertyId)}/channel-manager`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function setPropertyBlockedIps(
  accessToken: string,
  propertyId: string,
  ips: string[],
): Promise<{ blockedIps: string[] }> {
  return apiFetch(`/properties/${encodeURIComponent(propertyId)}/blocked-ips`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ ips }),
  });
}
