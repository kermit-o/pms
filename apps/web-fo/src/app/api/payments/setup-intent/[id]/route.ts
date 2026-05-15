import { auth } from '@/auth';
import { createStripeSetupIntent } from '@/lib/api';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  try {
    const out = await createStripeSetupIntent(session.accessToken, id);
    return Response.json(out);
  } catch (err) {
    const msg = (err as Error).message;
    return new Response(msg, { status: 500 });
  }
}
