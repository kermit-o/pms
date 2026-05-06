import { auth } from '@/auth';

const PAIRING_COOKIE = 'aubergine_pairing';

export default auth((req) => {
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

  // Camareras con pairing cookie: tratamos como autenticadas. La cookie es
  // HttpOnly y firmada HMAC; la API la valida en cada request — si caduca
  // o se invalida, las paginas devolveran 401 y el usuario tendra que
  // re-emparejar.
  const hasPairing = req.cookies.has(PAIRING_COOKIE);

  if (!req.auth && !hasPairing && !isPublic) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', path);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
