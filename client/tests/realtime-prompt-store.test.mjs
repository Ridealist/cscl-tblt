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

const PROMPT_VERSION = {
  ...PROMPT_CONFIG,
  promptId: '00000000-0000-4000-8000-000000000034',
  savedAt: '2026-06-12T00:00:00.000Z',
  source: 'custom',
  createdBy: 'admin-user',
  hash: 'hash-1',
  isActive: true,
  label: 'practice v1',
  legacyFilePurpose: null,
  legacyFileVersionId: null,
  purpose: 'practice',
};

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
      console,
      exports: module.exports,
      module,
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function loadPromptStore(options = {}) {
  const calls = {
    activate: [],
    clear: [],
    delete: [],
    list: [],
    read: [],
    readActive: 0,
    save: [],
  };

  const exports = loadModule('lib/realtime-prompt-store.ts', (specifier) => {
    if (specifier === 'server-only') {
      return {};
    }

    if (specifier === '@/lib/realtime-prompt-config') {
      return {};
    }

    if (specifier === '@/lib/prompt-version-db-store') {
      return {
        PromptVersionStoreError,
        activatePracticePromptVersion: async (versionId) => {
          calls.activate.push(versionId);
          return options.activatedVersion ?? PROMPT_VERSION;
        },
        clearActivePromptVersion: async (purpose) => {
          calls.clear.push(purpose);
        },
        deletePromptVersion: async (versionId, expectedPurpose) => {
          calls.delete.push({ expectedPurpose, versionId });
        },
        listPromptVersions: async (purpose) => {
          calls.list.push(purpose);
          return options.versions ?? [];
        },
        readActivePracticePromptVersion: async () => {
          calls.readActive += 1;
          if (options.readActiveError) throw options.readActiveError;
          return options.activeVersion ?? null;
        },
        readPracticePromptVersion: async (versionId) => {
          calls.read.push(versionId);
          return options.readVersion ?? null;
        },
        savePracticePromptVersion: async (config, saveOptions) => {
          calls.save.push({ config, options: saveOptions });
          if (options.saveError) throw options.saveError;
          return { ...PROMPT_VERSION, ...config, createdBy: saveOptions.createdBy ?? null };
        },
      };
    }

    throw new Error(`Unexpected import in realtime-prompt-store test: ${specifier}`);
  });

  return { ...exports, calls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('readActiveRealtimePromptVersion delegates to the practice DB store', async () => {
  const { calls, readActiveRealtimePromptVersion } = loadPromptStore({
    activeVersion: PROMPT_VERSION,
  });

  assert.deepEqual(plain(await readActiveRealtimePromptVersion()), plain(PROMPT_VERSION));
  assert.equal(calls.readActive, 1);
});

test('listRealtimePromptVersions delegates to prompt_versions practice rows', async () => {
  const versions = [{ id: 'v1', label: 'v1', createdAt: '2026-06-12T00:00:00.000Z', hash: 'h' }];
  const { calls, listRealtimePromptVersions } = loadPromptStore({ versions });

  assert.deepEqual(await listRealtimePromptVersions(), versions);
  assert.deepEqual(calls.list, ['practice']);
});

test('saveRealtimePromptVersion saves a practice version through the DB store', async () => {
  const { calls, saveRealtimePromptVersion } = loadPromptStore();

  const prompt = await saveRealtimePromptVersion(PROMPT_CONFIG, {
    createdBy: 'admin-user',
    label: 'Edited practice',
  });

  assert.equal(prompt.promptId, PROMPT_VERSION.promptId);
  assert.deepEqual(plain(calls.save), [
    {
      config: PROMPT_CONFIG,
      options: { createdBy: 'admin-user', label: 'Edited practice' },
    },
  ]);
});

test('activateRealtimePromptVersion delegates to the DB store', async () => {
  const { activateRealtimePromptVersion, calls } = loadPromptStore();

  await activateRealtimePromptVersion('practice-version-1');

  assert.deepEqual(calls.activate, ['practice-version-1']);
});

test('deleteRealtimePromptVersion delegates to the generic DB delete', async () => {
  const { calls, deleteRealtimePromptVersion } = loadPromptStore();

  await deleteRealtimePromptVersion('practice-version-1');

  assert.deepEqual(calls.delete, [
    { expectedPurpose: 'practice', versionId: 'practice-version-1' },
  ]);
});

test('deactivateActiveRealtimePromptVersion clears the active practice version', async () => {
  const { calls, deactivateActiveRealtimePromptVersion } = loadPromptStore();

  await deactivateActiveRealtimePromptVersion();

  assert.deepEqual(calls.clear, ['practice']);
});

test('RealtimePromptStoreError remains the shared prompt version store error class', async () => {
  const error = new PromptVersionStoreError('supabase_not_configured', 'missing');
  const { saveRealtimePromptVersion } = loadPromptStore({ saveError: error });

  await assert.rejects(
    () => saveRealtimePromptVersion(PROMPT_CONFIG),
    (actual) =>
      actual.name === 'PromptVersionStoreError' &&
      actual.code === 'supabase_not_configured' &&
      actual.status === 503
  );
});
