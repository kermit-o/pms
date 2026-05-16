import { auth } from '@/auth';
import { apiFetch } from '@/lib/api';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as { amount?: number; description?: string };
  if (!body.amount) return new Response('amount required', { status: 400 });
  try {
    const out = await apiFetch(`/payments/stripe/reservations/${id}/charge-no-show`, {
      method: 'POST',
      accessToken: session.accessToken,
      body: JSON.stringify(body),
    });
    return Response.json(out);
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
}
