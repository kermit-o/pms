import { publicConfirmSetupIntent } from '@/lib/api';

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const code = url.searchParams.get('code');
  const lastName = url.searchParams.get('lastName');
  if (!slug || !code || !lastName) {
    return new Response('slug, code y lastName son obligatorios', { status: 400 });
  }
  try {
    const out = await publicConfirmSetupIntent(slug, code, lastName);
    return Response.json(out);
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
}
