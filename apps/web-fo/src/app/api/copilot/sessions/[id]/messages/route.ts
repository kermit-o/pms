import { auth } from '@/auth';
import { sendCopilotMessage } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const url = new URL(req.url);
  const stream = url.searchParams.get('stream') === 'true';
  const body = (await req.json()) as { content?: string };
  if (!body.content) return new Response('content required', { status: 400 });

  if (stream) {
    // Passthrough del stream SSE de la API. Reescribimos el body sin tocar
    // los eventos — la deserializacion ocurre en el cliente.
    const upstream = await fetch(
      `${API_URL}/copilot/sessions/${ctx.params.id}/messages?stream=true`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.accessToken ?? ''}`,
        },
        body: JSON.stringify({ content: body.content }),
        cache: 'no-store',
      },
    );
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return new Response(text || `upstream ${upstream.status}`, { status: upstream.status });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  }

  const out = await sendCopilotMessage(session.accessToken, ctx.params.id, body.content);
  return Response.json(out);
}
