import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const PRACTICE_ROW = {
  id: '00000000-0000-4000-8000-000000000034',
  purpose: 'practice',
  base_prompt: 'Base prompt',
  dominant_prompt: 'Dominant prompt',
  collaborative_prompt: 'Collaborative prompt',
  feedback_condition_id: 'no_corrective',
  feedback_prompt: 'Feedback prompt',
  task_card_id: 'school_event_invitation',
  task_card_prompt: 'Task card prompt',
  source: 'custom',
  is_active: true,
  label: 'Practice version',
  hash: 'hash-practice',
  created_at: '2026-06-12T00:00:00.000Z',
  created_by: 'admin-user',
};

const EVALUATION_ROW = {
  id: '00000000-0000-4000-8000-000000000035',
  purpose: 'evaluation',
  evaluation_id: 'pretest_6_10',
  evaluation_prompt: '# PRE-TEST INTERACTION PROMPT: Kate\n# Opening\nHello.',
  evaluation_prompt_version: '2026-06-10',
  evaluation_character: 'Kate',
  evaluation_opening_sentence: 'Hello.',
  source: 'custom',
  is_active: true,
  label: 'Evaluation version',
  hash: 'hash-evaluation',
  created_at: '2026-06-13T00:00:00.000Z',
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
      Buffer,
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

function loadPromptVersionDbStore(options = {}) {
  const calls = {
    rpcs: [],
  };
  const exports = loadModule('lib/prompt-version-db-store.ts', (specifier) => {
    if (specifier === 'crypto') {
      return require('node:crypto');
    }
    if (specifier === 'server-only') {
      return {};
    }
    if (specifier === '@/lib/realtime-prompt-config') {
      return { validateRealtimePromptConfig };
    }
    if (specifier === '@/lib/supabase/admin') {
      return {
        createSupabaseAdminClient: () => ({
          rpc: async (name, args) => {
            calls.rpcs.push({ name, args });
            return {
              data: options.rpcData ?? null,
              error: options.rpcError ?? null,
            };
          },
        }),
        hasSupabaseAdminEnv: () => options.hasSupabaseAdminEnv !== false,
      };
    }
    throw new Error(`Unexpected import in prompt-version-db-store test: ${specifier}`);
  });
  return { ...exports, calls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('activatePracticePromptVersion scopes the activation RPC to practice rows', async () => {
  const { activatePracticePromptVersion, calls } = loadPromptVersionDbStore({
    rpcData: PRACTICE_ROW,
  });

  const version = await activatePracticePromptVersion(PRACTICE_ROW.id);

  assert.equal(version.promptId, PRACTICE_ROW.id);
  assert.deepEqual(plain(calls.rpcs), [
    {
      name: 'activate_prompt_version',
      args: {
        p_expected_purpose: 'practice',
        p_version_id: PRACTICE_ROW.id,
      },
    },
  ]);
});

test('activateEvaluationPromptVersion scopes the activation RPC to evaluation rows', async () => {
  const { activateEvaluationPromptVersion, calls } = loadPromptVersionDbStore({
    rpcData: EVALUATION_ROW,
  });

  const version = await activateEvaluationPromptVersion(EVALUATION_ROW.id);

  assert.equal(version.promptVersionId, EVALUATION_ROW.id);
  assert.deepEqual(plain(calls.rpcs), [
    {
      name: 'activate_prompt_version',
      args: {
        p_expected_purpose: 'evaluation',
        p_version_id: EVALUATION_ROW.id,
      },
    },
  ]);
});

test('deletePromptVersion requires an expected purpose for the delete RPC', async () => {
  const { calls, deletePromptVersion } = loadPromptVersionDbStore();

  await deletePromptVersion(EVALUATION_ROW.id, 'evaluation');

  assert.deepEqual(plain(calls.rpcs), [
    {
      name: 'delete_prompt_version',
      args: {
        p_expected_purpose: 'evaluation',
        p_version_id: EVALUATION_ROW.id,
      },
    },
  ]);
});
