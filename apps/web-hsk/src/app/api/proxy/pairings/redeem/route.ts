import { cookies } from 'next/headers';
import { ApiError, redeemPairing } from '@/lib/api';
import { PAIRING_COOKIE } from '@/lib/server-token';

export const dynamic = 'force-dynamic';

interface RedeemBody {
  tenantId: string;
  code: string;
}

export async function POST(req: Request) {
  let body: RedeemBody;
  try {
    body = (await req.json()) as RedeemBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  try {
    const out = await redeemPairing(body);
    const expiresAt = new Date(out.expiresAt);
    const jar = await cookies();
    jar.set(PAIRING_COOKIE, out.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    // No devolvemos el token al cliente — vive solo en la cookie HttpOnly.
    return Response.json({ ok: true, expiresAt: out.expiresAt, user: out.user });
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
