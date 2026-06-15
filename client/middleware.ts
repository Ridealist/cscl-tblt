import { type NextRequest, NextResponse } from 'next/server';
import { getAdminAuthFromRequest, updateSupabaseSession } from '@/lib/supabase/proxy';

const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/forbidden']);

function isProtectedApiPath(pathname: string) {
  return (
    pathname === '/api/dispatch' ||
    pathname.startsWith('/api/dispatch/') ||
    pathname === '/api/logs' ||
    pathname.startsWith('/api/logs/') ||
    pathname === '/api/rooms/terminate' ||
    pathname.startsWith('/api/admin/')
  );
}

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie.name, cookie.value);
  });
  return target;
}

function redirectToLogin(request: NextRequest, response: NextResponse) {
  const loginUrl = new URL('/admin/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return copyCookies(response, NextResponse.redirect(loginUrl));
}

function redirectToForbidden(request: NextRequest, response: NextResponse) {
  return copyCookies(response, NextResponse.redirect(new URL('/admin/forbidden', request.url)));
}

function jsonError(message: string, status: number, response: NextResponse) {
  return copyCookies(response, NextResponse.json({ error: message }, { status }));
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (PUBLIC_ADMIN_PATHS.has(pathname)) {
    return updateSupabaseSession(request);
  }

  const auth = await getAdminAuthFromRequest(request);
  if (auth.ok) {
    return auth.response;
  }

  if (isProtectedApiPath(pathname)) {
    return jsonError(auth.error, auth.status, auth.response);
  }

  if (auth.status === 401) {
    return redirectToLogin(request, auth.response);
  }

  if (auth.status === 403) {
    return redirectToForbidden(request, auth.response);
  }

  return new NextResponse(auth.error, { status: auth.status });
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    '/api/dispatch',
    '/api/dispatch/:path*',
    '/api/logs',
    '/api/logs/:path*',
    '/api/rooms/terminate',
  ],
};
