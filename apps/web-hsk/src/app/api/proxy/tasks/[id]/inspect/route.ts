import { ApiError, inspectTask } from '@/lib/api';
import { getApiToken } from '@/lib/server-token';

export const dynamic = 'force-dynamic';

interface InspectBody {
  imageBase64?: string;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const accessToken = await getApiToken();
  if (!accessToken) {
    return new Response('unauthenticated', { status: 401 });
  }
  let body: InspectBody = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as InspectBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  if (!body.imageBase64) {
    return new Response('imageBase64 required', { status: 400 });
  }
  try {
    const result = await inspectTask(accessToken, params.id, body.imageBase64);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
