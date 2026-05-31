import { auth } from '@/auth';
import { ApiError, getInvoiceByFolio } from '@/lib/api';

export async function GET(
  _req: Request,
  { params }: { params: { folioId: string } },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  try {
    const out = await getInvoiceByFolio(session.accessToken, params.folioId);
    if (!out) return new Response('Not Found', { status: 404 });
    return Response.json(out);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}
