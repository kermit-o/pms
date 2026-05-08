import { NextResponse, type NextRequest } from 'next/server';

// Edge-safe: NO importamos `@/auth` aqui. NextAuth v5 con el provider
// Keycloak carga modulos node-only en init que bloquean el Edge runtime
// — el healthcheck timeoutea y Fly deja de rutear trafico.
// La validez del JWT la verifica el server-side `auth()` en cada page.tsx
// y la API en cada request: si la cookie esta caducada/invalida, el
// usuario sera deslogueado a la primera respuesta 401.
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];
const PAIRING_COOKIE = 'aubergine_pairing';

export default function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublic =
    path === '/login' ||
    path === '/login/qr' ||
    path.startsWith('/api/auth') ||
    path.startsWith('/api/proxy/pairings/redeem') ||
    path.startsWith('/_next') ||
    path === '/manifest.webmanifest' ||
    path === '/sw.js' ||
    path === '/favicon.ico';

  if (isPublic) {
    return NextResponse.next();
  }

  // Camareras con pairing cookie: tratamos como autenticadas. La cookie es
  // HttpOnly y firmada HMAC; la API la valida en cada request — si caduca
  // o se invalida, las paginas devolveran 401 y el usuario tendra que
  // re-emparejar.
  const hasPairing = req.cookies.has(PAIRING_COOKIE);
  const hasSession = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));

  if (!hasSession && !hasPairing) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
