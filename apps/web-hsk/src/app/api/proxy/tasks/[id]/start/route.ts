import { auth } from '@/auth';
import { ApiError, startTask } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response('unauthenticated', { status: 401 });
  }
  try {
    const task = await startTask(session.accessToken, params.id);
    return Response.json(task);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
