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

      if (specifier === '@/lib/prompt-version-db-store') {
        const summary = (version) => ({
          id: version.promptVersionId,
          label: version.label,
          createdAt: version.savedAt,
          hash: version.hash,
        });
        return {
          activateEvaluationPromptVersion: async (versionId) => {
            const version = versions.get(versionId) ?? null;
            if (version) {
              activeVersionId = version.promptVersionId;
              version.isActive = true;
            }
            return version;
          },
          clearActivePromptVersion: async (purpose, options) => {
            assert.equal(purpose, 'evaluation');
            assert.equal(options.evaluationId, 'pretest_6_10');
            activeVersionId = null;
          },
          deletePromptVersion: async (versionId, expectedPurpose) => {
            assert.equal(expectedPurpose, 'evaluation');
            versions.delete(versionId);
            if (activeVersionId === versionId) activeVersionId = null;
          },
          listPromptVersions: async (purpose, options) => {
            assert.equal(purpose, 'evaluation');
            assert.equal(options.evaluationId, 'pretest_6_10');
            return [...versions.values()]
              .filter((version) => version.evaluationId === options.evaluationId)
              .map(summary);
          },
          readActiveEvaluationPromptVersion: async (evaluationId) => {
            assert.equal(evaluationId, 'pretest_6_10');
            const version = activeVersionId ? (versions.get(activeVersionId) ?? null) : null;
            return version?.evaluationId === evaluationId ? version : null;
          },
          readEvaluationPromptVersion: async (versionId) => versions.get(versionId) ?? null,
          saveEvaluationPromptVersion: async (config, options) => {
            const id = `eval-version-${nextVersionIndex++}`;
            const version = {
              createdBy: null,
              evaluationCharacter: config.evaluationCharacter,
              evaluationId: config.evaluationId,
              evaluationPromptId: id,
              evaluationPromptVersion: config.evaluationPromptVersion,
              hash: `hash-${id}`,
              isActive: true,
              label: options.label ?? `evaluation ${id}`,
              legacyFilePurpose: null,
              legacyFileVersionId: null,
              openingSentence: config.openingSentence,
              prompt: config.prompt,
              promptId: id,
              promptVersionId: id,
              purpose: 'evaluation',
              savedAt: '2026-06-13T00:00:00.000Z',
              source: 'custom',
            };
            for (const existing of versions.values()) existing.isActive = false;
            versions.set(id, version);
            activeVersionId = id;
            calls.createdVersions.push(version);
            return version;
          },
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
