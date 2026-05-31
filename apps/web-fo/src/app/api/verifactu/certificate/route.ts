import { auth } from '@/auth';
import { ApiError, getCertificate, revokeCertificate, uploadCertificate } from '@/lib/api';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  try {
    const out = await getCertificate(session.accessToken);
    if (!out) return new Response('Not Found', { status: 404 });
    return Response.json(out);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Partial<{
    p12Base64: string;
    passphrase: string;
  }>;
  if (!body.p12Base64 || !body.passphrase) {
    return new Response('p12Base64 and passphrase are required', { status: 400 });
  }
  try {
    const out = await uploadCertificate(session.accessToken, {
      p12Base64: body.p12Base64,
      passphrase: body.passphrase,
    });
    return Response.json(out, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Partial<{ reason: string }>;
  if (!body.reason) {
    return new Response('reason is required', { status: 400 });
  }
  try {
    const out = await revokeCertificate(session.accessToken, body.reason);
    return Response.json(out);
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body || err.message, { status: err.status });
    }
    throw err;
  }
}
