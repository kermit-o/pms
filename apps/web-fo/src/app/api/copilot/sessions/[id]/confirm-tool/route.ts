import { auth } from '@/auth';
import { confirmCopilotTool } from '@/lib/api';

export async function POST(
  req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json()) as {
    pendingToolId?: string;
    decision?: 'approve' | 'reject';
  };
  if (!body.pendingToolId || !body.decision) {
    return new Response('pendingToolId and decision required', { status: 400 });
  }
  const out = await confirmCopilotTool(
    session.accessToken,
    ctx.params.id,
    body.pendingToolId,
    body.decision,
  );
  return Response.json(out);
}
