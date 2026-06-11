import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

class FakeCookieJar {
  #cookies = [];

  constructor(cookies = []) {
    this.#cookies = cookies.map((cookie) => ({ ...cookie }));
  }

  getAll() {
    return this.#cookies.map((cookie) => ({ ...cookie }));
  }

  set(name, value, options) {
    const cookie =
      typeof name === 'object'
        ? { name: name.name, value: name.value, options: name.options }
        : { name, value, options };

    const index = this.#cookies.findIndex((existing) => existing.name === cookie.name);
    if (index === -1) {
      this.#cookies.push(cookie);
      return;
    }

    this.#cookies[index] = cookie;
  }
}

class FakeNextResponse {
  constructor(body = null, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.cookies = new FakeCookieJar();
    this.headers = new Map();
  }

  static next() {
    const response = new FakeNextResponse();
    response.kind = 'next';
    return response;
  }

  static redirect(url) {
    const response = new FakeNextResponse(null, { status: 307 });
    response.kind = 'redirect';
    response.headers.set('location', url.toString());
    return response;
  }

  static json(data, init = {}) {
    const response = new FakeNextResponse(JSON.stringify(data), { status: init.status ?? 200 });
    response.kind = 'json';
    response.jsonBody = data;
    return response;
  }
}

function loadModule(relativePath, requireMock) {
  const sourceUrl = new URL(`../${relativePath}`, import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileURLToPath(sourceUrl),
  });

  const module = { exports: {} };
  vm.runInNewContext(
    transpiled.outputText,
    {
      URL,
      exports: module.exports,
      module,
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function createRequest(path) {
  const url = new URL(path, 'https://example.test');
  return {
    url: url.toString(),
    nextUrl: {
      pathname: url.pathname,
      search: url.search,
    },
    cookies: new FakeCookieJar(),
  };
}

function createAuthResponse(cookies = []) {
  const response = FakeNextResponse.next();
  cookies.forEach((cookie) => response.cookies.set(cookie.name, cookie.value, cookie.options));
  return response;
}

function loadMiddleware(authResult) {
  const calls = {
    auth: [],
    updateSession: [],
  };

  const exports = loadModule('middleware.ts', (specifier) => {
    if (specifier === 'next/server') {
      return { NextResponse: FakeNextResponse };
    }

    if (specifier === '@/lib/supabase/proxy') {
      return {
        getAdminAuthFromRequest: async (request) => {
          calls.auth.push(request.nextUrl.pathname);
          return typeof authResult === 'function' ? authResult(request) : authResult;
        },
        updateSupabaseSession: async (request) => {
          calls.updateSession.push(request.nextUrl.pathname);
          return FakeNextResponse.next();
        },
      };
    }

    throw new Error(`Unexpected import in middleware test: ${specifier}`);
  });

  return { ...exports, calls };
}

function createSupabaseClient({ createError, profile, profileError, user, userError }) {
  if (createError) {
    return async () => {
      throw createError;
    };
  }

  return async () => ({
    auth: {
      getUser: async () => ({
        data: { user: user ?? null },
        error: userError ?? null,
      }),
    },
    from: (table) => {
      assert.equal(table, 'profiles');
      return {
        select: (columns) => {
          assert.equal(columns, 'role');
          return {
            eq: (column, userId) => {
              assert.equal(column, 'user_id');
              assert.equal(userId, user?.id);
              return {
                maybeSingle: async () => ({
                  data: profile ?? null,
                  error: profileError ?? null,
                }),
              };
            },
          };
        },
      };
    },
  });
}

function loadAdminAuth(supabaseOptions) {
  return loadModule('lib/supabase/admin-auth.ts', (specifier) => {
    if (specifier === 'next/server') {
      return { NextResponse: FakeNextResponse };
    }

    if (specifier === 'server-only') {
      return {};
    }

    if (specifier === '@/lib/supabase/server') {
      return {
        createSupabaseServerClient: createSupabaseClient(supabaseOptions),
      };
    }

    throw new Error(`Unexpected import in admin auth test: ${specifier}`);
  });
}

test('middleware refreshes Supabase session on public admin pages', async () => {
  const { calls, middleware } = loadMiddleware({
    ok: false,
    response: createAuthResponse(),
    status: 401,
    error: 'Authentication required.',
    user: null,
  });

  const response = await middleware(createRequest('/admin/login?next=%2Fadmin'));

  assert.equal(response.kind, 'next');
  assert.deepEqual(calls.updateSession, ['/admin/login']);
  assert.deepEqual(calls.auth, []);
});

test('middleware allows authenticated admins through', async () => {
  const authResponse = createAuthResponse([{ name: 'sb-refresh', value: 'token' }]);
  const { calls, middleware } = loadMiddleware({
    ok: true,
    response: authResponse,
    user: { id: 'admin-user' },
  });

  const response = await middleware(createRequest('/admin'));

  assert.equal(response, authResponse);
  assert.deepEqual(calls.auth, ['/admin']);
});

test('middleware redirects unauthenticated admin pages to login with next URL', async () => {
  const { middleware } = loadMiddleware({
    ok: false,
    response: createAuthResponse([{ name: 'sb-refresh', value: 'token' }]),
    status: 401,
    error: 'Authentication required.',
    user: null,
  });

  const response = await middleware(createRequest('/admin?tab=rooms'));
  const location = new URL(response.headers.get('location'));

  assert.equal(response.kind, 'redirect');
  assert.equal(location.pathname, '/admin/login');
  assert.equal(location.searchParams.get('next'), '/admin?tab=rooms');
  assert.deepEqual(
    response.cookies.getAll().map(({ name, value }) => ({ name, value })),
    [{ name: 'sb-refresh', value: 'token' }]
  );
});

test('middleware redirects non-admin users away from admin pages', async () => {
  const { middleware } = loadMiddleware({
    ok: false,
    response: createAuthResponse(),
    status: 403,
    error: 'Admin role required.',
    user: { id: 'student-user' },
  });

  const response = await middleware(createRequest('/admin/dashboard'));
  const location = new URL(response.headers.get('location'));

  assert.equal(response.kind, 'redirect');
  assert.equal(location.pathname, '/admin/forbidden');
});

test('middleware returns JSON errors for protected admin APIs', async () => {
  const { middleware } = loadMiddleware({
    ok: false,
    response: createAuthResponse(),
    status: 401,
    error: 'Authentication required.',
    user: null,
  });

  const response = await middleware(createRequest('/api/admin/config'));

  assert.equal(response.kind, 'json');
  assert.equal(response.status, 401);
  assert.equal(response.jsonBody.error, 'Authentication required.');
});

test('middleware protects dispatch and room termination APIs', async () => {
  const { middleware } = loadMiddleware((request) => ({
    ok: false,
    response: createAuthResponse(),
    status: 403,
    error: `${request.nextUrl.pathname} requires admin access.`,
    user: { id: 'student-user' },
  }));

  const dispatchResponse = await middleware(createRequest('/api/dispatch'));
  const terminateResponse = await middleware(createRequest('/api/rooms/terminate'));

  assert.equal(dispatchResponse.status, 403);
  assert.equal(dispatchResponse.jsonBody.error, '/api/dispatch requires admin access.');
  assert.equal(terminateResponse.status, 403);
  assert.equal(terminateResponse.jsonBody.error, '/api/rooms/terminate requires admin access.');
});

test('middleware matcher only targets admin surfaces and protected APIs', () => {
  const { config } = loadMiddleware({
    ok: true,
    response: createAuthResponse(),
    user: { id: 'admin-user' },
  });

  assert.deepEqual(Array.from(config.matcher), [
    '/admin/:path*',
    '/api/admin/:path*',
    '/api/dispatch',
    '/api/dispatch/:path*',
    '/api/logs',
    '/api/logs/:path*',
    '/api/rooms/terminate',
  ]);
  assert.equal(config.matcher.includes('/'), false);
  assert.equal(config.matcher.includes('/api/token'), false);
});

test('requireAdmin returns null when the user has an admin profile', async () => {
  const { requireAdmin } = loadAdminAuth({
    profile: { role: 'admin' },
    user: { id: 'admin-user' },
  });

  await assert.doesNotReject(async () => {
    assert.equal(await requireAdmin(), null);
  });
});

test('requireAdmin returns 503 when Supabase is not configured', async () => {
  const { requireAdmin } = loadAdminAuth({
    createError: new Error('Missing Supabase environment'),
  });

  const response = await requireAdmin();

  assert.equal(response.status, 503);
  assert.equal(response.jsonBody.error, 'Supabase authentication is not configured.');
});

test('requireAdmin returns 401 when no user session is present', async () => {
  const { requireAdmin } = loadAdminAuth({
    user: null,
  });

  const response = await requireAdmin();

  assert.equal(response.status, 401);
  assert.equal(response.jsonBody.error, 'Authentication required.');
});

test('requireAdmin returns 403 when the profile is not admin', async () => {
  const { requireAdmin } = loadAdminAuth({
    profile: { role: 'student' },
    user: { id: 'student-user' },
  });

  const response = await requireAdmin();

  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error, 'Admin role required.');
});

test('requireAdmin returns 500 when profile lookup fails', async () => {
  const { requireAdmin } = loadAdminAuth({
    profileError: new Error('database unavailable'),
    user: { id: 'admin-user' },
  });

  const response = await requireAdmin();

  assert.equal(response.status, 500);
  assert.equal(response.jsonBody.error, 'Unable to verify admin role.');
});
