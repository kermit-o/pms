import { auth } from '@/auth';

export default auth((req) => {
  const isPublic =
    req.nextUrl.pathname === '/login' ||
    req.nextUrl.pathname.startsWith('/api/auth') ||
    req.nextUrl.pathname.startsWith('/_next') ||
    req.nextUrl.pathname === '/manifest.webmanifest' ||
    req.nextUrl.pathname === '/sw.js' ||
    req.nextUrl.pathname === '/favicon.ico';

  if (!req.auth && !isPublic) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
