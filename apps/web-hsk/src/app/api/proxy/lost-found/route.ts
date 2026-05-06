import { ApiError, registerLostFound } from '@/lib/api';
import { getApiToken } from '@/lib/server-token';

export const dynamic = 'force-dynamic';

interface RegisterBody {
  propertyId: string;
  roomId?: string;
  description: string;
  photoBase64?: string;
  notes?: string;
}

export async function POST(req: Request) {
  const accessToken = await getApiToken();
  if (!accessToken) {
    return new Response('unauthenticated', { status: 401 });
  }
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  try {
    const item = await registerLostFound(accessToken, body);
    return Response.json(item);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
