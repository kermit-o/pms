import { publicConfirmPaymentIntent } from '@/lib/api';

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const code = url.searchParams.get('code');
  const lastName = url.searchParams.get('lastName');
  let body: { paymentIntentId?: string } = {};
  try {
    body = (await req.json()) as { paymentIntentId?: string };
  } catch {
    /* tolerate empty body */
  }
  if (!slug || !code || !lastName || !body.paymentIntentId) {
    return new Response('slug, code, lastName y paymentIntentId son obligatorios', {
      status: 400,
    });
  }
  try {
    const out = await publicConfirmPaymentIntent(slug, code, lastName, body.paymentIntentId);
    return Response.json(out);
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
}
