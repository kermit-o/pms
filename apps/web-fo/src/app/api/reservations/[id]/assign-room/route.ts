import { auth } from '@/auth';
import { assignRoom } from '@/lib/api';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  let body: { roomId?: string } = {};
  try {
    body = (await req.json()) as { roomId?: string };
  } catch {
    /* empty */
  }
  if (!body.roomId) {
    return new Response('roomId is required', { status: 400 });
  }
  try {
    const out = await assignRoom(session.accessToken, id, body.roomId);
    return Response.json(out);
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
}
