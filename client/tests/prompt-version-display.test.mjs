import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadPromptVersionDisplay() {
  const sourceUrl = new URL('../lib/prompt-version-display.ts', import.meta.url);
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
      exports: module.exports,
      module,
    },
    { filename: 'lib/prompt-version-display.ts' }
  );
  return module.exports;
}

test('prompt version displays user-provided labels when present', () => {
  const { promptVersionCustomLabelDisplay, promptVersionDisplayLabel } = loadPromptVersionDisplay();
  const version = {
    id: '2f95b13f-4066-4fb9-bbb4-5e23c00ded02',
    label: 'Midterm practice prompt v2',
  };

  assert.equal(promptVersionDisplayLabel(version), 'Midterm practice prompt v2');
  assert.equal(promptVersionCustomLabelDisplay(version), 'Midterm practice prompt v2');
});

test('prompt version dropdown falls back to id for generated labels', () => {
  const { promptVersionDisplayLabel } = loadPromptVersionDisplay();
  const version = {
    id: '2f95b13f-4066-4fb9-bbb4-5e23c00ded02',
    label: 'practice 2026-06-16 14:41:28.000+00',
  };

  assert.equal(promptVersionDisplayLabel(version), '2f95b13f-4066-4fb9-bbb4-5e23c00ded02');
});

test('active summary shows missing custom label text for generated labels', () => {
  const { promptVersionCustomLabelDisplay } = loadPromptVersionDisplay();
  const version = {
    id: 'eval-version-1',
    label: 'evaluation eval-version-1',
  };

  assert.equal(promptVersionCustomLabelDisplay(version), '사용자 지정 버전명 없음');
});

test('active summary shows default prompt versions as defaults', () => {
  const { promptVersionCustomLabelDisplay, promptVersionDisplayLabel } = loadPromptVersionDisplay();
  const version = {
    id: 'default',
    label: null,
    usingDefault: true,
  };

  assert.equal(promptVersionDisplayLabel(version), 'Tracked markdown default');
  assert.equal(promptVersionCustomLabelDisplay(version), '기본값');
});
