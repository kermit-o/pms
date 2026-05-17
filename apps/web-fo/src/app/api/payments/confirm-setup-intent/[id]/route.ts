import { auth } from '@/auth';
import { apiFetch } from '@/lib/api';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  try {
    const out = await apiFetch(
      `/payments/stripe/reservations/${id}/confirm-setup-intent`,
      { method: 'POST', accessToken: session.accessToken, body: JSON.stringify({}) },
    );
    return Response.json(out);
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
}
