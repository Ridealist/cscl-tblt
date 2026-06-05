import { type NextRequest, NextResponse } from 'next/server';

function unauthorized() {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="CSCL TBLT Admin"',
    },
  });
}

function readBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header) return null;

  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return null;

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.next();
    }

    return new NextResponse('Admin credentials not configured', { status: 503 });
  }

  const credentials = readBasicAuth(request.headers.get('authorization'));
  if (credentials?.username === adminUsername && credentials.password === adminPassword) {
    return NextResponse.next();
  }

  return unauthorized();
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
