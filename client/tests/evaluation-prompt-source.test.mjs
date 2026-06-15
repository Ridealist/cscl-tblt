import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const DEFAULT_PROMPT =
  '# PRE-TEST INTERACTION PROMPT: Kate\n# Opening\nHello default.\n# Body\nDefault prompt.';
const CUSTOM_PROMPT =
  '# PRE-TEST INTERACTION PROMPT: Kate\n# Opening\nHello custom.\n# Body\nCustom prompt.';

const FILES = new Map(
  Object.entries({
    '/repo/prompts/evaluation/manifest.json': JSON.stringify({
      defaultEvaluationId: 'pretest_6_10',
      evaluations: {
        pretest_6_10: {
          character: 'Kate',
          file: 'pretest_6_10.md',
          marker: '# PRE-TEST INTERACTION PROMPT: Kate',
          promptId: 'pretest_6_10',
          version: '2026-06-10',
        },
      },
    }),
    '/repo/prompts/evaluation/pretest_6_10.md': DEFAULT_PROMPT,
  })
);

function loadModule(relativePath, requireMock, processMock) {
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

function loadEvaluationPromptSource() {
  const versions = new Map();
  let activeVersionId = null;
  let nextVersionIndex = 1;
  const calls = {
    createdVersions: [],
  };
  const processMock = {
    cwd: () => '/repo/client',
  };

  const exports = loadModule(
    'lib/evaluation-prompt-source.ts',
    (specifier) => {
      if (specifier === 'server-only') {
        return {};
      }

      if (specifier === 'fs/promises') {
        return {
          mkdir: async () => {},
          readFile: async (target) => {
            const normalized = target.toString();
            if (!FILES.has(normalized)) {
              throw Object.assign(new Error(`missing file: ${normalized}`), { code: 'ENOENT' });
            }
            return FILES.get(normalized);
          },
          rename: async () => {},
          unlink: async () => {},
          writeFile: async () => {},
        };
      }

      if (specifier === 'path') {
        return path;
      }

      if (specifier === '@/lib/prompt-version-store') {
        const summary = (version) => ({
          id: version.id,
          label: version.label,
          createdAt: version.createdAt,
          hash: version.hash,
        });
        return {
          activatePromptVersion: async (purpose, versionId) => {
            assert.equal(purpose, 'evaluation');
            const version = versions.get(versionId) ?? null;
            if (version) activeVersionId = version.id;
            return version;
          },
          clearActivePromptVersion: async (purpose) => {
            assert.equal(purpose, 'evaluation');
            activeVersionId = null;
          },
          createPromptVersion: async ({ activate, config, label, purpose }) => {
            assert.equal(purpose, 'evaluation');
            const id = `eval-version-${nextVersionIndex++}`;
            const version = {
              schemaVersion: 1,
              purpose,
              id,
              label: label ?? `evaluation ${id}`,
              createdAt: '2026-06-13T00:00:00.000Z',
              hash: `hash-${id}`,
              config,
            };
            versions.set(id, version);
            if (activate) activeVersionId = id;
            calls.createdVersions.push(version);
            return version;
          },
          deletePromptVersion: async (purpose, versionId) => {
            assert.equal(purpose, 'evaluation');
            versions.delete(versionId);
            if (activeVersionId === versionId) activeVersionId = null;
          },
          readActivePromptVersion: async (purpose) => {
            assert.equal(purpose, 'evaluation');
            return activeVersionId ? (versions.get(activeVersionId) ?? null) : null;
          },
          readPromptVersion: async (purpose, versionId) => {
            assert.equal(purpose, 'evaluation');
            return versions.get(versionId) ?? null;
          },
          readPromptVersionIndex: async () => ({
            active: { evaluation: activeVersionId },
            versions: { evaluation: [...versions.values()].map(summary), realtime: [] },
          }),
        };
      }

      throw new Error(`Unexpected import in evaluation-prompt-source test: ${specifier}`);
    },
    processMock
  );

  return { ...exports, calls };
}

test('readEvaluationPromptState returns tracked manifest default', async () => {
  const { readEvaluationPromptState } = loadEvaluationPromptSource();

  const state = await readEvaluationPromptState();

  assert.equal(state.usingDefault, true);
  assert.equal(state.evaluationId, 'pretest_6_10');
  assert.equal(state.evaluationPromptId, 'pretest_6_10');
  assert.equal(state.openingSentence, 'Hello default.');
  assert.equal(state.prompt, DEFAULT_PROMPT);
  assert.equal(state.promptVersions.length, 0);
});

test('writeEvaluationPromptOverride stores and activates an immutable version', async () => {
  const { calls, writeEvaluationPromptOverride } = loadEvaluationPromptSource();

  const state = await writeEvaluationPromptOverride({
    evaluationId: 'pretest_6_10',
    label: 'Edited eval',
    prompt: CUSTOM_PROMPT,
  });

  assert.equal(state.usingDefault, false);
  assert.equal(state.promptVersionId, 'eval-version-1');
  assert.equal(state.activePromptVersionId, 'eval-version-1');
  assert.equal(state.openingSentence, 'Hello custom.');
  assert.equal(state.prompt, CUSTOM_PROMPT);
  assert.equal(calls.createdVersions[0].label, 'Edited eval');
});

test('activateEvaluationPromptVersion returns the selected stored version', async () => {
  const { activateEvaluationPromptVersion, writeEvaluationPromptOverride } =
    loadEvaluationPromptSource();

  await writeEvaluationPromptOverride({
    evaluationId: 'pretest_6_10',
    prompt: CUSTOM_PROMPT,
  });
  const state = await activateEvaluationPromptVersion('eval-version-1');

  assert.equal(state.promptVersionId, 'eval-version-1');
  assert.equal(state.activePromptVersionId, 'eval-version-1');
  assert.equal(state.prompt, CUSTOM_PROMPT);
});
