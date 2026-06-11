import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const PROMPT_CONFIG = {
  basePrompt: 'Base prompt',
  dominantPrompt: 'Dominant prompt',
  collaborativePrompt: 'Collaborative prompt',
  feedbackConditionId: 'explicit_correction',
  feedbackPrompt: 'Feedback prompt',
  taskCardId: 'school_event_invitation',
  taskCardPrompt: 'Task card prompt',
};

const PROMPT_ROW = {
  id: '00000000-0000-4000-8000-000000000034',
  base_prompt: PROMPT_CONFIG.basePrompt,
  dominant_prompt: PROMPT_CONFIG.dominantPrompt,
  collaborative_prompt: PROMPT_CONFIG.collaborativePrompt,
  feedback_condition_id: PROMPT_CONFIG.feedbackConditionId,
  feedback_prompt: PROMPT_CONFIG.feedbackPrompt,
  task_card_id: PROMPT_CONFIG.taskCardId,
  task_card_prompt: PROMPT_CONFIG.taskCardPrompt,
  source: 'custom',
  is_active: true,
  created_at: '2026-06-12T00:00:00.000Z',
  created_by: 'admin-user',
};

function loadModule(relativePath, requireMock, processMock = process) {
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
      console,
      exports: module.exports,
      module,
      process: processMock,
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function validateRealtimePromptConfig(value) {
  const required = [
    'basePrompt',
    'dominantPrompt',
    'collaborativePrompt',
    'feedbackConditionId',
    'feedbackPrompt',
    'taskCardId',
    'taskCardPrompt',
  ];
  for (const key of required) {
    if (typeof value?.[key] !== 'string' || !value[key].trim()) {
      return { ok: false, error: `${key} invalid` };
    }
  }
  return {
    ok: true,
    config: Object.fromEntries(required.map((key) => [key, value[key].trim()])),
  };
}

function createSupabaseClient(options, calls) {
  return {
    from(table) {
      assert.equal(table, 'realtime_prompt_versions');
      return {
        select(columns) {
          calls.selects.push(columns);
          return {
            eq(column, value) {
              assert.equal(column, 'is_active');
              assert.equal(value, true);
              return {
                maybeSingle: async () => ({
                  data: options.readRow ?? null,
                  error: options.readError ?? null,
                }),
              };
            },
          };
        },
      };
    },
    rpc(name, args) {
      calls.rpcs.push({ name, args });
      return Promise.resolve({
        data: options.rpcData ?? null,
        error: options.rpcError ?? null,
      });
    },
  };
}

function loadPromptStore(options = {}) {
  const calls = {
    rpcs: [],
    selects: [],
  };

  const exports = loadModule('lib/realtime-prompt-store.ts', (specifier) => {
    if (specifier === 'server-only') {
      return {};
    }

    if (specifier === '@/lib/realtime-prompt-config') {
      return { validateRealtimePromptConfig };
    }

    if (specifier === '@/lib/supabase/admin') {
      return {
        createSupabaseAdminClient: () => createSupabaseClient(options, calls),
        hasSupabaseAdminEnv: () => options.hasSupabaseAdminEnv !== false,
      };
    }

    throw new Error(`Unexpected import in realtime-prompt-store test: ${specifier}`);
  });

  return { ...exports, calls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('readActiveRealtimePromptVersion maps active Supabase row to prompt metadata', async () => {
  const { readActiveRealtimePromptVersion } = loadPromptStore({ readRow: PROMPT_ROW });

  const prompt = await readActiveRealtimePromptVersion();

  assert.deepEqual(plain(prompt), {
    ...PROMPT_CONFIG,
    promptId: PROMPT_ROW.id,
    savedAt: PROMPT_ROW.created_at,
    source: 'custom',
    createdBy: PROMPT_ROW.created_by,
    isActive: true,
  });
});

test('readActiveRealtimePromptVersion returns null when no active row exists', async () => {
  const { readActiveRealtimePromptVersion } = loadPromptStore({ readRow: null });

  assert.equal(await readActiveRealtimePromptVersion(), null);
});

test('readActiveRealtimePromptVersion returns null when Supabase is not configured', async () => {
  const { calls, readActiveRealtimePromptVersion } = loadPromptStore({
    hasSupabaseAdminEnv: false,
  });

  assert.equal(await readActiveRealtimePromptVersion(), null);
  assert.equal(calls.selects.length, 0);
});

test('saveRealtimePromptVersion activates one new version through RPC', async () => {
  const { calls, saveRealtimePromptVersion } = loadPromptStore({ rpcData: PROMPT_ROW });

  const prompt = await saveRealtimePromptVersion(PROMPT_CONFIG, { createdBy: 'admin-user' });

  assert.equal(prompt.promptId, PROMPT_ROW.id);
  assert.deepEqual(plain(calls.rpcs), [
    {
      name: 'activate_realtime_prompt_version',
      args: {
        p_base_prompt: PROMPT_CONFIG.basePrompt,
        p_dominant_prompt: PROMPT_CONFIG.dominantPrompt,
        p_collaborative_prompt: PROMPT_CONFIG.collaborativePrompt,
        p_feedback_condition_id: PROMPT_CONFIG.feedbackConditionId,
        p_feedback_prompt: PROMPT_CONFIG.feedbackPrompt,
        p_task_card_id: PROMPT_CONFIG.taskCardId,
        p_task_card_prompt: PROMPT_CONFIG.taskCardPrompt,
        p_created_by: 'admin-user',
      },
    },
  ]);
});

test('deactivateActiveRealtimePromptVersion deactivates active custom prompt through RPC', async () => {
  const { calls, deactivateActiveRealtimePromptVersion } = loadPromptStore();

  await deactivateActiveRealtimePromptVersion();

  assert.deepEqual(plain(calls.rpcs), [
    {
      name: 'deactivate_realtime_prompt_versions',
    },
  ]);
});

test('saveRealtimePromptVersion fails when Supabase is not configured', async () => {
  const { saveRealtimePromptVersion } = loadPromptStore({ hasSupabaseAdminEnv: false });

  await assert.rejects(
    () => saveRealtimePromptVersion(PROMPT_CONFIG),
    (error) =>
      error.name === 'RealtimePromptStoreError' &&
      error.code === 'supabase_not_configured' &&
      error.status === 503
  );
});

test('readActiveRealtimePromptVersion reports Supabase read failures', async () => {
  const { readActiveRealtimePromptVersion } = loadPromptStore({
    readError: new Error('database unavailable'),
  });

  await assert.rejects(
    () => readActiveRealtimePromptVersion(),
    (error) =>
      error.name === 'RealtimePromptStoreError' &&
      error.code === 'prompt_version_read_failed' &&
      error.status === 503
  );
});
