import { auth } from '@/auth';
import { ApiError, getEmisor, updateEmisor } from '@/lib/api';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  try {
    const out = await getEmisor(session.accessToken);
    return Response.json(out);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}

export async function PUT(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Partial<{
    nif: string;
    razonSocial: string;
  }>;
  if (!body.nif || !body.razonSocial) {
    return new Response('nif and razonSocial are required', { status: 400 });
  }
  try {
    const out = await updateEmisor(session.accessToken, {
      nif: body.nif,
      razonSocial: body.razonSocial,
    });
    return Response.json(out);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}
