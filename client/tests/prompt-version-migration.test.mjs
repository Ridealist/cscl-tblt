import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const MIGRATION = readFileSync(
  new URL(
    '../../supabase/migrations/20260616000000_prompt_versions_unification.sql',
    import.meta.url
  ),
  'utf-8'
);
const CONDITION_COMBINATION_MIGRATION = readFileSync(
  new URL(
    '../../supabase/migrations/20260617000000_condition_combination_prompts.sql',
    import.meta.url
  ),
  'utf-8'
);

test('compatibility realtime_prompt_versions view uses invoker security', () => {
  assert.match(
    MIGRATION,
    /create\s+view\s+public\.realtime_prompt_versions\s+with\s*\(\s*security_invoker\s*=\s*true\s*\)\s+as/i
  );
});

test('activate and delete RPCs accept expected purpose before mutating prompt_versions', () => {
  assert.match(
    MIGRATION,
    /create\s+or\s+replace\s+function\s+public\.activate_prompt_version\s*\(\s*p_version_id\s+uuid,\s*p_expected_purpose\s+text\s+default\s+null\s*\)/i
  );
  assert.match(MIGRATION, /selected\.purpose\s*<>\s*normalized_expected_purpose/i);
  assert.match(
    MIGRATION,
    /create\s+or\s+replace\s+function\s+public\.delete_prompt_version\s*\(\s*p_version_id\s+uuid,\s*p_expected_purpose\s+text\s+default\s+null\s*\)/i
  );
  assert.match(
    MIGRATION,
    /normalized_expected_purpose\s+is\s+null\s+or\s+purpose\s+=\s+normalized_expected_purpose/i
  );
});

test('condition-combination migration adds JSONB storage and RPC parameters', () => {
  assert.match(
    CONDITION_COMBINATION_MIGRATION,
    /add\s+column\s+if\s+not\s+exists\s+condition_combination_prompts\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb/i
  );
  assert.match(
    CONDITION_COMBINATION_MIGRATION,
    /jsonb_typeof\s*\(\s*condition_combination_prompts\s*\)\s*=\s*'object'/i
  );
  assert.match(
    CONDITION_COMBINATION_MIGRATION,
    /p_condition_combination_prompts\s+jsonb\s+default\s+'\{\}'::jsonb/i
  );
  assert.match(
    CONDITION_COMBINATION_MIGRATION,
    /condition_combination_prompts\s*=\s*excluded\.condition_combination_prompts/i
  );
});
