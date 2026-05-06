import { ApiError, mintPairing } from '@/lib/api';
import { getApiToken } from '@/lib/server-token';

export const dynamic = 'force-dynamic';

interface MintBody {
  targetUserId: string;
  ttlSeconds?: number;
}

export async function POST(req: Request) {
  const accessToken = await getApiToken();
  if (!accessToken) {
    return new Response('unauthenticated', { status: 401 });
  }
  let body: MintBody;
  try {
    body = (await req.json()) as MintBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  try {
    const pairing = await mintPairing(accessToken, body);
    return Response.json(pairing);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
