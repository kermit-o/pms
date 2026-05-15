import type { ListReservationsQuery } from '@/lib/api';

const KEYS = [
  'from',
  'to',
  'arrivalFrom',
  'arrivalTo',
  'departureFrom',
  'departureTo',
  'status',
  'source',
  'groupId',
  'search',
  'guaranteeStatus',
  'unassigned',
  'cursor',
] as const;

/**
 * Convierte los searchParams crudos (que pueden ser arrays cuando el form
 * usa <select multiple>) en el shape de ListReservationsQuery (CSV strings
 * para listas).
 */
export function normalizeReservationsQuery(
  raw: Record<string, string | string[] | undefined>,
): ListReservationsQuery {
  const out: Record<string, string> = {};
  for (const key of KEYS) {
    const v = raw[key];
    if (v === undefined) continue;
    const csv = Array.isArray(v) ? v.filter(Boolean).join(',') : v;
    if (csv) out[key] = csv;
  }
  return out as ListReservationsQuery;
}
