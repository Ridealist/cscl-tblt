import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadAgentCharacter() {
  const sourceUrl = new URL('../lib/agent-character.ts', import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: fileURLToPath(sourceUrl),
  });
  const module = { exports: {} };
  vm.runInNewContext(transpiled.outputText, { exports: module.exports, module });
  return module.exports;
}

test('manifest character resolution preserves registered presentation and voice metadata', () => {
  const { resolveManifestTaskCharacter } = loadAgentCharacter();
  const characters = {
    nova: {
      displayName: 'Nova',
      avatarSrc: '/agents/nova.png',
      voiceId: 'nova-voice-v2',
      ttsSpeed: 0.75,
      ttsVolume: 0.95,
    },
  };

  const resolvedByTask = resolveManifestTaskCharacter(characters, 'nova');
  const resolvedByPromptName = resolveManifestTaskCharacter(characters, 'missing', 'nova');

  assert.equal(resolvedByTask.id, 'nova');
  assert.equal(resolvedByTask.voiceId, 'nova-voice-v2');
  assert.equal(resolvedByTask.avatarSrc, '/agents/nova.png');
  assert.equal(resolvedByPromptName.id, 'nova');
  assert.equal(resolvedByPromptName.ttsSpeed, 0.75);
});
