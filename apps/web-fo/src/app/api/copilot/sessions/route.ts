import { auth } from '@/auth';
import { createCopilotSession } from '@/lib/api';
import { getActivePropertyId } from '@/lib/active-property';

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { propertyId?: string };
  // Si el cliente no pasa propertyId, inyectamos la property activa del
  // operador. Asi el copilot no tiene que preguntarle el UUID en cada turno.
  const propertyId = body.propertyId ?? (await getActivePropertyId()) ?? undefined;
  const out = await createCopilotSession(session.accessToken, propertyId);
  return Response.json(out);
}
