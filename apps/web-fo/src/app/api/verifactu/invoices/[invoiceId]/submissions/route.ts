import { auth } from '@/auth';
import { ApiError, listInvoiceSubmissions, requeueInvoiceSubmission } from '@/lib/api';

export async function GET(
  _req: Request,
  { params }: { params: { invoiceId: string } },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  try {
    const out = await listInvoiceSubmissions(session.accessToken, params.invoiceId);
    return Response.json(out);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: { invoiceId: string } },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  try {
    const out = await requeueInvoiceSubmission(session.accessToken, params.invoiceId);
    return Response.json(out, { status: 202 });
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}
