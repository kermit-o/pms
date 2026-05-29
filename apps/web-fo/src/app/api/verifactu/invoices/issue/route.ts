import { auth } from '@/auth';
import { ApiError, issueInvoice, type IssueInvoiceInput } from '@/lib/api';

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Partial<IssueInvoiceInput>;
  if (!body.folioId || !body.customerName) {
    return new Response('folioId and customerName are required', { status: 400 });
  }
  try {
    const out = await issueInvoice(session.accessToken, body as IssueInvoiceInput);
    return Response.json(out);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}
