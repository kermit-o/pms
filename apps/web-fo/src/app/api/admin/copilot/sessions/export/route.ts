import { auth } from '@/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Sprint 13 — Proxy server-side del export CSV de sesiones Copilot
 * para el admin. Forwarda el access token de NextAuth (el browser
 * nunca lo ve) y pasa los filtros tal cual. La respuesta llega con
 * Content-Disposition adjunto desde el upstream, así que el navegador
 * descarga directamente.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!session.roles?.includes('tenant_admin')) {
    return new Response('Forbidden', { status: 403 });
  }

  const incoming = new URL(req.url);
  const upstream = await fetch(
    `${API_URL}/copilot/sessions/admin/export.csv?${incoming.searchParams.toString()}`,
    {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
    },
  );

  if (!upstream.ok) {
    const body = await upstream.text();
    return new Response(body || upstream.statusText, { status: upstream.status });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'content-disposition':
        upstream.headers.get('content-disposition') ??
        'attachment; filename="copilot-sessions.csv"',
    },
  });
}
