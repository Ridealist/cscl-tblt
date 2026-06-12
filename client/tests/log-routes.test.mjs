import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

class FakeNextResponse {
  constructor(body = null, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
  }

  static json(data, init = {}) {
    const response = new FakeNextResponse(JSON.stringify(data), { status: init.status ?? 200 });
    response.jsonBody = data;
    return response;
  }
}

class TestLogStoreError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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
      TextEncoder,
      URL,
      URLSearchParams,
      exports: module.exports,
      module,
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function request(path) {
  return {
    url: new URL(path, 'https://example.test').toString(),
    signal: new AbortController().signal,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadLogsRoute(options = {}) {
  const calls = {
    filters: [],
    readSessions: 0,
    requireAdmin: 0,
  };

  const exports = loadModule('app/api/logs/route.ts', (specifier) => {
    if (specifier === 'next/server') return { NextResponse: FakeNextResponse };
    if (specifier === '@/lib/supabase/admin-auth') {
      return {
        requireAdmin: async () => {
          calls.requireAdmin += 1;
          return options.adminError ?? null;
        },
      };
    }
    if (specifier === '@/lib/conversation-log-store') {
      return {
        ConversationLogStoreError: TestLogStoreError,
        parseConversationLogSessionFilters: (searchParams) => {
          const filters = Object.fromEntries(searchParams.entries());
          calls.filters.push(filters);
          return filters;
        },
        readConversationLogSessions: async () => {
          calls.readSessions += 1;
          if (options.storeError) throw options.storeError;
          return options.sessions ?? [];
        },
      };
    }
    throw new Error(`Unexpected import in logs route test: ${specifier}`);
  });

  return { ...exports, calls };
}

function loadLogsStreamRoute(options = {}) {
  const calls = {
    readData: [],
    requireAdmin: 0,
  };

  const exports = loadModule('app/api/logs/stream/route.ts', (specifier) => {
    if (specifier === 'next/server') return { NextResponse: FakeNextResponse };
    if (specifier === '@/lib/supabase/admin-auth') {
      return {
        requireAdmin: async () => {
          calls.requireAdmin += 1;
          return options.adminError ?? null;
        },
      };
    }
    if (specifier === '@/lib/conversation-log-store') {
      return {
        ConversationLogStoreError: TestLogStoreError,
        readConversationLogData: async (input) => {
          calls.readData.push(input);
          return options.logData ?? { id: input.sessionId, entries: [] };
        },
      };
    }
    throw new Error(`Unexpected import in logs stream route test: ${specifier}`);
  });

  return { ...exports, calls };
}

test('GET /api/logs requires admin before reading sessions', async () => {
  const adminError = FakeNextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { GET, calls } = loadLogsRoute({ adminError });

  const response = await GET(request('/api/logs'));

  assert.equal(response.status, 401);
  assert.equal(calls.requireAdmin, 1);
  assert.equal(calls.readSessions, 0);
});

test('GET /api/logs returns Supabase-backed sessions', async () => {
  const sessions = [{ id: 'session-id', source: 'supabase', room: '1반-1그룹' }];
  const { GET, calls } = loadLogsRoute({ sessions });

  const response = await GET(request('/api/logs?agentMode=realtime'));

  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.jsonBody), { sessions });
  assert.deepEqual(plain(calls.filters), [{ agentMode: 'realtime' }]);
  assert.equal(calls.readSessions, 1);
});

test('GET /api/logs maps store errors to JSON responses', async () => {
  const { GET } = loadLogsRoute({
    storeError: new TestLogStoreError(503, 'supabase_not_configured', 'Supabase missing.'),
  });

  const response = await GET(request('/api/logs'));

  assert.equal(response.status, 503);
  assert.deepEqual(plain(response.jsonBody), {
    error: 'Supabase missing.',
    code: 'supabase_not_configured',
  });
});

test('GET /api/logs/stream requires admin before opening stream', async () => {
  const adminError = FakeNextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  const { GET, calls } = loadLogsStreamRoute({ adminError });

  const response = await GET(request('/api/logs/stream?sessionId=session-id'));

  assert.equal(response.status, 403);
  assert.equal(calls.requireAdmin, 1);
  assert.deepEqual(plain(calls.readData), []);
});

test('GET /api/logs/stream rejects requests without sessionId or fallback filename', async () => {
  const { GET, calls } = loadLogsStreamRoute();

  const response = await GET(request('/api/logs/stream'));

  assert.equal(response.status, 400);
  assert.equal(response.jsonBody.code, 'session_id_required');
  assert.deepEqual(plain(calls.readData), []);
});
