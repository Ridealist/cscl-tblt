import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadRealtimePromptConfig() {
  const sourceUrl = new URL('../lib/realtime-prompt-config.ts', import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
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
    { filename: 'lib/realtime-prompt-config.ts' }
  );
  return module.exports;
}

test('validateRealtimePromptConfig removes obsolete conversation-example stack line', () => {
  const { validateRealtimePromptConfig } = loadRealtimePromptConfig();
  const result = validateRealtimePromptConfig({
    basePrompt: [
      '# BASE PROMPT: Runtime',
      '# Prompt Stack',
      'Use this prompt with:',
      '1. ONE Interlocutor Role Prompt',
      '2. ONE Condition Combination Prompt',
      '3. ONE Task Card',
      '4. ONE Conversation Example, when available',
    ].join('\n'),
    collaborativePrompt: '# INTERLOCUTOR ROLE PROMPT: Collaborative\nCollaborative role.',
    conditionCombinationPrompts: {
      collaborative_no_feedback: '# CONDITION COMBINATION PROMPT: Collaborative + No Feedback',
      collaborative_explicit_correction:
        '# CONDITION COMBINATION PROMPT: Collaborative + Explicit Correction',
      dominant_no_feedback: '# CONDITION COMBINATION PROMPT: Dominant + No Feedback',
      dominant_explicit_correction:
        '# CONDITION COMBINATION PROMPT: Dominant + Explicit Correction',
    },
    dominantPrompt: '# INTERLOCUTOR ROLE PROMPT: Dominant\nDominant role.',
    feedbackConditionId: 'no_corrective',
    feedbackPrompt: '# FEEDBACK CONDITION PROMPT: No Feedback\nNo feedback.',
    taskCardId: 'school_event_invitation',
    taskCardPrompt: '# TASK CARD: School Event Invitation\nTask card.',
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.config.basePrompt.includes('4. ONE Conversation Example, when available'),
    false
  );
  assert.equal(result.config.basePrompt.includes('3. ONE Task Card'), true);
});

test('validateRealtimePromptConfig defaults missing task card id to L5-T3', () => {
  const { validateRealtimePromptConfig } = loadRealtimePromptConfig();
  const result = validateRealtimePromptConfig({
    basePrompt: '# BASE PROMPT:\nBase.',
    collaborativePrompt: '# INTERLOCUTOR ROLE PROMPT: Collaborative\nCollaborative role.',
    dominantPrompt: '# INTERLOCUTOR ROLE PROMPT: Dominant\nDominant role.',
    feedbackPrompt: '# FEEDBACK CONDITION PROMPT: No Feedback\nNo feedback.',
    taskCardPrompt: '# TASK CARD: Our Class Special Activity Plan\nTask card.',
  });

  assert.equal(result.ok, true);
  assert.equal(result.config.taskCardId, 'special_activity_plan');
});
