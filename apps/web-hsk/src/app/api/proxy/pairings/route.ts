import QRCode from 'qrcode';
import { ApiError, mintPairing } from '@/lib/api';
import { getApiToken } from '@/lib/server-token';

export const dynamic = 'force-dynamic';
// QRCode usa Buffer (Node) — fuera del runtime Edge.
export const runtime = 'nodejs';

interface MintBody {
  targetUserId: string;
  ttlSeconds?: number;
}

/**
 * Mintea un pairing y devuelve, ademas del codigo, el deep-link HTTPS y un
 * QR ya renderizado en SVG. La camara nativa del telefono reconoce URLs
 * http(s) — el scheme custom `aubergine-pairing:` no — asi que el QR
 * codifica el deep-link del propio frontend, que al abrirse autoredime y
 * setea la cookie HttpOnly.
 */
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
    const origin = new URL(req.url).origin;
    const deepLink = `${origin}/login/qr?tenantId=${pairing.tenantId}&code=${pairing.code}`;
    const qrSvg = await QRCode.toString(deepLink, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#5C2A4D', light: '#FFFFFF' },
    });
    return Response.json({ ...pairing, deepLink, qrSvg });
  } catch (err) {
    if (err instanceof ApiError) {
      return new Response(err.body, { status: err.status });
    }
    return new Response((err as Error).message, { status: 500 });
  }
}
