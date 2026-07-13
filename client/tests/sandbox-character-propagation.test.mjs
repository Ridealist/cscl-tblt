import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const APP = readFileSync(new URL('../components/app/app.tsx', import.meta.url), 'utf8');
const LOBBY = readFileSync(new URL('../components/app/lobby-view.tsx', import.meta.url), 'utf8');

test('sandbox join preserves the task character selected in the lobby', () => {
  assert.match(APP, /NEXT_PUBLIC_CONN_DETAILS_ENDPOINT/);
  assert.match(APP, /setSessionAgentCharacter\(options\?\.agentCharacter \?\? KATE_CHARACTER\)/);
  assert.match(
    LOBBY,
    /agentCharacter:\s*activityType === 'free_conversation' \? JACK_CHARACTER : practiceCharacter/
  );
});
