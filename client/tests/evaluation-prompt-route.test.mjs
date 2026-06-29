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

class EvaluationPromptSourceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'EvaluationPromptSourceError';
    this.status = status;
  }
}

class PromptVersionStoreError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'PromptVersionStoreError';
    this.code = code;
    this.status = status;
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

function request(path, body) {
  return {
    url: new URL(path, 'https://example.test').toString(),
    json: async () => body,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadEvaluationPromptRoute(options = {}) {
  const calls = {
    activate: [],
    delete: [],
    read: [],
    requireAdmin: 0,
    write: [],
  };

  const exports = loadModule('app/api/admin/prompts/evaluation/route.ts', (specifier) => {
    if (specifier === 'next/server') {
      return { NextResponse: FakeNextResponse };
    }

    if (specifier === '@/lib/evaluation-prompt-source') {
      return {
        EvaluationPromptSourceError,
        activateEvaluationPromptVersion: async (versionId) => {
          calls.activate.push(versionId);
          if (options.activateError) throw options.activateError;
          return { activated: versionId };
        },
        deleteEvaluationPromptOverride: async (payload) => {
          calls.delete.push(payload);
          if (options.deleteError) throw options.deleteError;
          return { deleted: payload };
        },
        readEvaluationPromptState: async (payload) => {
          calls.read.push(payload);
          if (options.readError) throw options.readError;
          return { state: payload };
        },
        writeEvaluationPromptOverride: async (payload) => {
          calls.write.push(payload);
          if (options.writeError) throw options.writeError;
          return { saved: payload };
        },
      };
    }

    if (specifier === '@/lib/supabase/admin-auth') {
      return {
        requireAdmin: async () => {
          calls.requireAdmin += 1;
          return options.adminError ?? null;
        },
      };
    }

    if (specifier === '@/lib/prompt-version-db-store') {
      return { PromptVersionStoreError };
    }

    throw new Error(`Unexpected import in evaluation prompt route test: ${specifier}`);
  });

  return { ...exports, calls };
}

test('GET requires admin before reading evaluation prompt state', async () => {
  const adminError = FakeNextResponse.json({ error: 'auth required' }, { status: 401 });
  const { GET, calls } = loadEvaluationPromptRoute({ adminError });

  const response = await GET(request('/api/admin/prompts/evaluation'));

  assert.equal(response, adminError);
  assert.equal(calls.requireAdmin, 1);
  assert.deepEqual(calls.read, []);
});

test('GET forwards evaluation, version, and default query params', async () => {
  const { GET, calls } = loadEvaluationPromptRoute();

  const response = await GET(
    request('/api/admin/prompts/evaluation?evaluationId=pretest_6_10&versionId=v1&default=1')
  );

  assert.equal(response.status, 200);
  assert.deepEqual(plain(calls.read), [
    { evaluationId: 'pretest_6_10', useDefault: true, versionId: 'v1' },
  ]);
  assert.deepEqual(plain(response.jsonBody.state), plain(calls.read[0]));
});

test('POST stores a new evaluation prompt version', async () => {
  const { POST, calls } = loadEvaluationPromptRoute();

  const response = await POST(
    request('/api/admin/prompts/evaluation', {
      evaluationId: ' pretest_6_10 ',
      prompt: '# PRE-TEST INTERACTION PROMPT: Jack\nEdited prompt.',
      versionLabel: 'Edited evaluation prompt',
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(plain(calls.write), [
    {
      evaluationId: 'pretest_6_10',
      label: 'Edited evaluation prompt',
      prompt: '# PRE-TEST INTERACTION PROMPT: Jack\nEdited prompt.',
    },
  ]);
});

test('POST activates a selected evaluation prompt version', async () => {
  const { POST, calls } = loadEvaluationPromptRoute();

  const response = await POST(
    request('/api/admin/prompts/evaluation', { action: 'activate', versionId: 'eval-version-1' })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls.activate, ['eval-version-1']);
  assert.deepEqual(response.jsonBody, { activated: 'eval-version-1' });
});

test('DELETE forwards evaluation and version params', async () => {
  const { DELETE, calls } = loadEvaluationPromptRoute();

  const response = await DELETE(
    request('/api/admin/prompts/evaluation?evaluationId=pretest_6_10&versionId=eval-version-1')
  );

  assert.equal(response.status, 200);
  assert.deepEqual(plain(calls.delete), [
    {
      evaluationId: 'pretest_6_10',
      versionId: 'eval-version-1',
    },
  ]);
});
