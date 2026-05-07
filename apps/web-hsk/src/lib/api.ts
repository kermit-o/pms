/**
 * Thin REST client for the Aubergine API. The access token from the
 * NextAuth session is forwarded as a Bearer for the API to validate via
 * Keycloak JWKS.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

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

// ---------------------------------------------------------------------------
// Housekeeping tasks
// ---------------------------------------------------------------------------

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TaskType = 'CHECKOUT_CLEAN' | 'STAYOVER_CLEAN' | 'INSPECTION' | 'MAINTENANCE';

export interface Task {
  id: string;
  propertyId: string;
  roomId: string;
  businessDate: string;
  taskType: TaskType;
  status: TaskStatus;
  assignedToUserId: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number | null;
  scheduledFor: string | null;
  notes: string | null;
}

export async function listTasks(
  accessToken: string | undefined,
  query: {
    propertyId?: string;
    assignedToUserId?: string;
    status?: TaskStatus;
    from?: string;
    to?: string;
  } = {},
): Promise<Task[]> {
  const params = new URLSearchParams();
  if (query.propertyId) params.set('propertyId', query.propertyId);
  if (query.assignedToUserId) params.set('assignedToUserId', query.assignedToUserId);
  if (query.status) params.set('status', query.status);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const q = params.toString();
  return apiFetch(`/housekeeping/tasks${q ? `?${q}` : ''}`, { accessToken });
}

export async function getTask(accessToken: string | undefined, taskId: string): Promise<Task> {
  return apiFetch(`/housekeeping/tasks/${taskId}`, { accessToken });
}

export async function startTask(accessToken: string | undefined, taskId: string): Promise<Task> {
  return apiFetch(`/housekeeping/tasks/${taskId}/start`, {
    method: 'POST',
    accessToken,
  });
}

export async function completeTask(
  accessToken: string | undefined,
  taskId: string,
  input: {
    resultingRoomStatus?: 'CLEAN' | 'INSPECTED' | 'DIRTY' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE';
    notes?: string;
  } = {},
): Promise<Task> {
  return apiFetch(`/housekeeping/tasks/${taskId}/complete`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function reassignTask(
  accessToken: string | undefined,
  taskId: string,
  assignedToUserId: string | null,
): Promise<Task> {
  return apiFetch(`/housekeeping/tasks/${taskId}/reassign`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ assignedToUserId }),
  });
}

export interface TaskSummary {
  propertyId: string;
  businessDate: string;
  total: number;
  byStatus: Record<TaskStatus, number>;
  byType: Record<TaskType, number>;
  byAssignee: { userId: string | null; total: number; completed: number }[];
  avgDurationMin: number | null;
}

export async function getTaskSummary(
  accessToken: string | undefined,
  query: { propertyId: string; businessDate: string },
): Promise<TaskSummary> {
  const params = new URLSearchParams(query);
  return apiFetch(`/housekeeping/tasks/summary?${params.toString()}`, { accessToken });
}

export interface AssignmentSuggestion {
  taskId: string;
  roomId: string;
  roomNumber: string;
  floor: string | null;
  taskType: TaskType;
  currentlyAssignedToUserId: string | null;
  suggestedUserId: string;
  predictedMin: number;
}

export interface UnmatchedTask {
  taskId: string;
  roomNumber: string;
  floor: string | null;
  taskType: TaskType;
  predictedMin: number;
  reason: 'no_candidates' | 'capacity_exhausted';
}

export interface AssignmentSuggestions {
  propertyId: string;
  businessDate: string;
  shiftCapacityMin: number;
  defaultDurationMin: number;
  candidates: {
    userId: string;
    totalAssignedMin: number;
    taskCount: number;
    remainingMin: number;
  }[];
  suggestions: AssignmentSuggestion[];
  unmatched: UnmatchedTask[];
}

export async function getAssignmentSuggestions(
  accessToken: string | undefined,
  query: {
    propertyId: string;
    businessDate: string;
    candidateUserIds?: string[];
    shiftCapacityMin?: number;
    lookbackDays?: number;
  },
): Promise<AssignmentSuggestions> {
  const params = new URLSearchParams();
  params.set('propertyId', query.propertyId);
  params.set('businessDate', query.businessDate);
  if (query.candidateUserIds?.length) {
    params.set('candidateUserIds', query.candidateUserIds.join(','));
  }
  if (query.shiftCapacityMin != null) {
    params.set('shiftCapacityMin', String(query.shiftCapacityMin));
  }
  if (query.lookbackDays != null) {
    params.set('lookbackDays', String(query.lookbackDays));
  }
  return apiFetch(`/housekeeping/tasks/suggestions?${params.toString()}`, { accessToken });
}

// ---------------------------------------------------------------------------
// Lost & Found
// ---------------------------------------------------------------------------

export type LostFoundStatus = 'FOUND' | 'CLAIMED' | 'DISPOSED';

export interface LostFoundItem {
  id: string;
  propertyId: string;
  roomId: string | null;
  foundByUserId: string;
  foundAt: string;
  description: string;
  hasPhoto: boolean;
  status: LostFoundStatus;
  claimedByGuestId: string | null;
  claimedAt: string | null;
  disposedAt: string | null;
  notes: string | null;
}

export async function listLostFound(
  accessToken: string | undefined,
  query: { propertyId?: string; status?: LostFoundStatus } = {},
): Promise<LostFoundItem[]> {
  const params = new URLSearchParams();
  if (query.propertyId) params.set('propertyId', query.propertyId);
  if (query.status) params.set('status', query.status);
  const q = params.toString();
  return apiFetch(`/housekeeping/lost-found${q ? `?${q}` : ''}`, { accessToken });
}

export async function registerLostFound(
  accessToken: string | undefined,
  input: {
    propertyId: string;
    roomId?: string;
    description: string;
    photoBase64?: string;
    notes?: string;
  },
): Promise<LostFoundItem> {
  return apiFetch(`/housekeeping/lost-found`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function claimLostFound(
  accessToken: string | undefined,
  itemId: string,
  input: { guestId?: string; notes?: string } = {},
): Promise<LostFoundItem> {
  return apiFetch(`/housekeeping/lost-found/${itemId}/claim`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function disposeLostFound(
  accessToken: string | undefined,
  itemId: string,
  reason: string,
): Promise<LostFoundItem> {
  return apiFetch(`/housekeeping/lost-found/${itemId}/dispose`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ reason }),
  });
}

// ---------------------------------------------------------------------------
// Device pairings (login QR)
// ---------------------------------------------------------------------------

export interface MintedPairing {
  id: string;
  code: string;
  tenantId: string;
  targetUserId: string;
  expiresAt: string;
  qrPayload: string;
}

export interface RedeemedPairing {
  token: string;
  expiresAt: string;
  user: {
    sub: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
}

export async function mintPairing(
  accessToken: string | undefined,
  input: { targetUserId: string; ttlSeconds?: number },
): Promise<MintedPairing> {
  return apiFetch(`/housekeeping/pairings`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function redeemPairing(input: {
  tenantId: string;
  code: string;
}): Promise<RedeemedPairing> {
  return apiFetch(`/housekeeping/pairings/redeem`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
