import { auth } from '@/auth';
import { ApiError, completeTask } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface CompleteBody {
  resultingRoomStatus?: 'CLEAN' | 'INSPECTED' | 'DIRTY' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE';
  notes?: string;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response('unauthenticated', { status: 401 });
  }
  let body: CompleteBody = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as CompleteBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  try {
    const task = await completeTask(session.accessToken, params.id, body);
    return Response.json(task);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
