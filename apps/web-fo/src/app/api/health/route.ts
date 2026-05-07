/**
 * Healthcheck simple para el load balancer de Fly. Solo verifica que el
 * proceso Node esta vivo — no toca DB ni la API. La readiness real (puede
 * conectar a Keycloak / API upstream) la hace cada page server-side al
 * renderizar; un fallo ahi se traduce en un 5xx visible al usuario.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return Response.json({ ok: true, service: 'web-fo', ts: new Date().toISOString() });
}
