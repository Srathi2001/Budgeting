import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, renewSession, sessionCookieOptions, verifySession } from '@/lib/auth/session';

// Optimistic check only: every page and server action re-checks the user via the DAL.
// Each request renews the session, so it ends after 15 minutes without activity.
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    const url = new URL('/login', request.url);
    if (request.nextUrl.pathname !== '/') url.searchParams.set('next', request.nextUrl.pathname);
    // a token that was there but has run out: signed out for inactivity
    if (token) url.searchParams.set('idle', '1');
    const res = request.nextUrl.pathname.startsWith('/api/') ? new NextResponse('Signed out', { status: 401 }) : NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  // facilities management works in Home and the FM budget only (lease, tenant and revenue screens are not theirs)
  const path = request.nextUrl.pathname;
  if (session.role === 'FM' && path !== '/' && path !== '/fm' && !path.startsWith('/fm/') && path !== '/api/export/fm-template' && path !== '/api/export/input-template' && path !== '/api/session/ping') {
    if (path.startsWith('/api/')) return new NextResponse('Forbidden', { status: 403 });
    return NextResponse.redirect(new URL('/fm', request.url));
  }
  const res = NextResponse.next();
  const renewed = await renewSession(session);
  if (renewed) res.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions);
  return res;
}

export const config = {
  // api/import: large uploads read as a stream; the route checks the user itself. api/health: the hosting's
  // health check (no sign-in, no data)
  matcher: ['/((?!login|api/import|api/health|_next/static|_next/image|favicon.ico).*)'],
};
