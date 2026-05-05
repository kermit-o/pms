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

export async function apiFetch(
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<Response> {
  const { accessToken, headers, ...rest } = init;
  const merged: HeadersInit = {
    'content-type': 'application/json',
    ...(headers ?? {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
  return fetch(`${API_URL}${path}`, { ...rest, headers: merged, cache: 'no-store' });
}
