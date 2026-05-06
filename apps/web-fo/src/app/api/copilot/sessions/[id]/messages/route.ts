import { auth } from '@/auth';
import { sendCopilotMessage } from '@/lib/api';

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json()) as { content?: string };
  if (!body.content) return new Response('content required', { status: 400 });
  const out = await sendCopilotMessage(session.accessToken, ctx.params.id, body.content);
  return Response.json(out);
}
