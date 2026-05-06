import { auth } from '@/auth';
import { createCopilotSession } from '@/lib/api';

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { propertyId?: string };
  const out = await createCopilotSession(session.accessToken, body.propertyId);
  return Response.json(out);
}
