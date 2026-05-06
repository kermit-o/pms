import { auth } from '@/auth';
import { ApiError, reassignTask } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface ReassignBody {
  assignedToUserId: string | null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response('unauthenticated', { status: 401 });
  }
  let body: ReassignBody;
  try {
    body = (await req.json()) as ReassignBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  try {
    const task = await reassignTask(session.accessToken, params.id, body.assignedToUserId);
    return Response.json(task);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
