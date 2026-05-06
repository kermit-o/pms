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
