/**
 * Healthcheck simple para el load balancer de Fly. Solo verifica que el
 * proceso Node esta vivo — no toca la API ni Keycloak.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return Response.json({ ok: true, service: 'web-hsk', ts: new Date().toISOString() });
}
