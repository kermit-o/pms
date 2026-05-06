import { auth } from '@/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const ALLOWED = new Set(['manager', 'revenue', 'tax', 'in-house', 'arrivals-departures']);

/**
 * Server-side CSV proxy. Forwards the access token from the NextAuth
 * session so the browser never sees it; passes through the API's
 * Content-Disposition so the file lands as a download.
 */
export async function GET(req: Request, ctx: { params: { type: string } }): Promise<Response> {
  if (!ALLOWED.has(ctx.params.type)) {
    return new Response('unknown report', { status: 404 });
  }
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const incoming = new URL(req.url);
  const params = new URLSearchParams(incoming.searchParams);
  params.set('format', 'csv');

  const upstream = await fetch(`${API_URL}/reports/${ctx.params.type}?${params.toString()}`, {
    headers: {
      ...(session.accessToken ? { authorization: `Bearer ${session.accessToken}` } : {}),
    },
    cache: 'no-store',
  });

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
        `attachment; filename="${ctx.params.type}.csv"`,
    },
  });
}
