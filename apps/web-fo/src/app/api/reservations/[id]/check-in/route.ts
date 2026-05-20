import { auth } from '@/auth';
import { checkInReservation } from '@/lib/api';

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
    /* empty body is fine */
  }
  try {
    const out = await checkInReservation(session.accessToken, id, body.roomId);
    return Response.json(out);
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
}
