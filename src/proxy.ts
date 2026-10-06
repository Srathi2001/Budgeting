import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

// Optimistic check only: every page and server action re-checks the user via the DAL.
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = new URL('/login', request.url);
    if (request.nextUrl.pathname !== '/') url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // api/import: large uploads read as a stream; the route checks the user itself
  matcher: ['/((?!login|api/import|_next/static|_next/image|favicon.ico).*)'],
};
