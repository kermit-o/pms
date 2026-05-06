import { auth } from '@/auth';
import { getGuestAccessExport } from '@/lib/api';

/**
 * GDPR access-right proxy: forwards the API call with the user session token
 * and returns a JSON file download. Keeps the access token off the client.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  const data = await getGuestAccessExport(session.accessToken, ctx.params.id);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="guest-${ctx.params.id}-access-export.json"`,
    },
  });
}
