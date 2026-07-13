import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

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

function createSupabaseClient(options, calls) {
  return {
    from(table) {
      assert.equal(table, 'app_settings');
      return {
        select(columns) {
          assert.equal(columns, '*');
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, 'default');
              return {
                maybeSingle: async () => ({
                  data: options.readRow ?? null,
                  error: options.readError ?? null,
                }),
              };
            },
          };
        },
        upsert(payload, upsertOptions) {
          calls.upserts.push({ payload, options: upsertOptions });
          return {
            select(columns) {
              assert.equal(columns, '*');
              return {
                single: async () => ({
                  data: options.writeRow ?? payload,
                  error: options.writeError ?? null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

function loadSettingsStore(options = {}) {
  const calls = {
    mkdirs: [],
    readFiles: [],
    renames: [],
    upserts: [],
    writes: [],
  };
  const processMock = {
    cwd: () => '/repo/client',
    env: {
      NODE_ENV: options.nodeEnv ?? 'development',
    },
  };

  const exports = loadModule(
    'lib/settings-store.ts',
    (specifier) => {
      if (specifier === 'server-only') {
        return {};
      }

      if (specifier === 'fs/promises') {
        return {
          mkdir: async (target, mkdirOptions) => {
            calls.mkdirs.push({ target, options: mkdirOptions });
          },
          readFile: async (target, encoding) => {
            calls.readFiles.push({ target, encoding });
            if (options.readFileError) {
              throw options.readFileError;
            }
            return options.readFileContent ?? '{}';
          },
          rename: async (from, to) => {
            calls.renames.push({ from, to });
          },
          writeFile: async (target, content, encoding) => {
            calls.writes.push({ target, content, encoding });
          },
        };
      }

      if (specifier === 'path') {
        return path;
      }

      if (specifier === '@/lib/agent-mode') {
        return {
          normalizeAgentMode: (value) => (value === 'realtime' ? 'realtime' : 'pipeline'),
        };
      }

      if (specifier === '@/lib/agent-role') {
        return {
          DEFAULT_AGENT_ROLE: 'dominant',
          normalizeAgentRole: (value) =>
            value === 'collaborative' || value === 'passive' ? 'collaborative' : 'dominant',
        };
      }

      if (specifier === '@/lib/session-activity') {
        return {
          normalizeSessionPurpose: (value) => (value === 'evaluation' ? 'evaluation' : 'practice'),
        };
      }

      if (specifier === '@/lib/supabase/admin') {
        return {
          createSupabaseAdminClient: () => createSupabaseClient(options, calls),
          hasSupabaseAdminEnv: () => options.hasSupabaseAdminEnv !== false,
        };
      }

      throw new Error(`Unexpected import in settings-store test: ${specifier}`);
    },
    processMock
  );

  return { ...exports, calls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('readSettings maps Supabase app_settings rows to normalized settings', async () => {
  const { readSettings } = loadSettingsStore({
    readRow: {
      num_classes: 4,
      num_groups_per_class: 12,
      class_start: 9,
      active_class: 99,
      agent_mode: 'realtime',
      agent_role: 'passive',
      feedback_condition_id: 'unknown',
      session_purpose: 'evaluation',
      realtime_resetting: true,
    },
  });

  const settings = await readSettings({
    feedbackConditionIds: ['no_corrective', 'explicit_correction'],
  });

  assert.deepEqual(plain(settings), {
    numClasses: 4,
    numGroupsPerClass: 12,
    classStart: 9,
    activeClass: 12,
    agentMode: 'realtime',
    agentRole: 'collaborative',
    feedbackConditionId: 'no_corrective',
    sessionPurpose: 'evaluation',
    realtimeResetting: true,
  });
});

test('writeSettings merges input and upserts app_settings with updated_by', async () => {
  const { calls, writeSettings } = loadSettingsStore({
    readRow: {
      num_classes: 4,
      num_groups_per_class: 4,
      class_start: 9,
      active_class: 9,
      agent_mode: 'pipeline',
      agent_role: 'dominant',
      feedback_condition_id: 'no_corrective',
      session_purpose: 'practice',
      realtime_resetting: false,
    },
  });

  const settings = await writeSettings(
    {
      activeClass: 99,
      agentMode: 'realtime',
      agentRole: 'dominant',
      classStart: 11,
      feedbackConditionId: 'explicit_correction',
      numClasses: 2,
      sessionPurpose: 'evaluation',
      realtimeResetting: true,
    },
    {
      feedbackConditionIds: ['no_corrective', 'explicit_correction'],
      updatedBy: 'admin-user',
    }
  );

  assert.deepEqual(plain(settings), {
    numClasses: 2,
    numGroupsPerClass: 4,
    classStart: 11,
    activeClass: 12,
    agentMode: 'realtime',
    agentRole: 'collaborative',
    feedbackConditionId: 'explicit_correction',
    sessionPurpose: 'evaluation',
    realtimeResetting: true,
  });
  assert.deepEqual(plain(calls.upserts), [
    {
      payload: {
        id: 'default',
        num_classes: 2,
        num_groups_per_class: 4,
        class_start: 11,
        active_class: 12,
        agent_mode: 'realtime',
        agent_role: 'collaborative',
        feedback_condition_id: 'explicit_correction',
        session_purpose: 'evaluation',
        realtime_resetting: true,
        updated_by: 'admin-user',
      },
      options: { onConflict: 'id' },
    },
  ]);
});

test('readSettings falls back to config.json in local development when Supabase is missing', async () => {
  const { calls, readSettings } = loadSettingsStore({
    hasSupabaseAdminEnv: false,
    readFileContent: JSON.stringify({
      activeClass: 3,
      agentMode: 'realtime',
      agentStance: 'passive',
      classStart: 2,
      feedbackConditionId: 'explicit_correction',
      numClasses: 3,
      numGroupsPerClass: 8,
      sessionPurpose: 'evaluation',
      realtimeResetting: true,
    }),
  });

  const settings = await readSettings({
    feedbackConditionIds: ['no_corrective', 'explicit_correction'],
  });

  assert.deepEqual(plain(settings), {
    numClasses: 3,
    numGroupsPerClass: 8,
    classStart: 2,
    activeClass: 3,
    agentMode: 'realtime',
    agentRole: 'collaborative',
    feedbackConditionId: 'explicit_correction',
    sessionPurpose: 'evaluation',
    realtimeResetting: true,
  });
  assert.equal(calls.readFiles.length, 1);
});

test('readSettings overlays local session purpose when Supabase schema does not return it', async () => {
  const { calls, readSettings } = loadSettingsStore({
    readRow: {
      num_classes: 4,
      num_groups_per_class: 4,
      class_start: 1,
      active_class: 1,
      agent_mode: 'realtime',
      agent_role: 'dominant',
      feedback_condition_id: 'no_corrective',
      realtime_resetting: false,
    },
    readFileContent: JSON.stringify({
      activeClass: 1,
      agentMode: 'realtime',
      agentRole: 'dominant',
      classStart: 1,
      feedbackConditionId: 'no_corrective',
      numClasses: 4,
      numGroupsPerClass: 4,
      sessionPurpose: 'evaluation',
      realtimeResetting: false,
    }),
  });

  const settings = await readSettings();

  assert.deepEqual(plain(settings), {
    numClasses: 4,
    numGroupsPerClass: 4,
    classStart: 1,
    activeClass: 1,
    agentMode: 'realtime',
    agentRole: 'collaborative',
    feedbackConditionId: 'no_corrective',
    sessionPurpose: 'evaluation',
    realtimeResetting: false,
  });
  assert.equal(calls.readFiles.length, 1);
});

test('readSettings falls back to config.json in local development when Supabase read fails', async () => {
  const { calls, readSettings } = loadSettingsStore({
    readError: new Error('database unavailable'),
    readFileContent: JSON.stringify({
      activeClass: 10,
      agentMode: 'pipeline',
      agentRole: 'dominant',
      classStart: 9,
      feedbackConditionId: 'no_corrective',
      numClasses: 4,
      numGroupsPerClass: 12,
      sessionPurpose: 'practice',
      realtimeResetting: false,
    }),
  });

  const settings = await readSettings();

  assert.deepEqual(plain(settings), {
    numClasses: 4,
    numGroupsPerClass: 12,
    classStart: 9,
    activeClass: 10,
    agentMode: 'pipeline',
    agentRole: 'collaborative',
    feedbackConditionId: 'no_corrective',
    sessionPurpose: 'practice',
    realtimeResetting: false,
  });
  assert.equal(calls.readFiles.length, 1);
});

test('writeSettings falls back to config.json in local development when Supabase is missing', async () => {
  const { calls, writeSettings } = loadSettingsStore({
    hasSupabaseAdminEnv: false,
    readFileContent: JSON.stringify({
      activeClass: 1,
      agentMode: 'pipeline',
      agentRole: 'dominant',
      classStart: 1,
      feedbackConditionId: 'no_corrective',
      numClasses: 4,
      numGroupsPerClass: 4,
      sessionPurpose: 'practice',
      realtimeResetting: false,
    }),
  });

  const settings = await writeSettings({ realtimeResetting: true });

  assert.equal(settings.realtimeResetting, true);
  assert.deepEqual(JSON.parse(calls.writes[0].content), {
    numClasses: 4,
    numGroupsPerClass: 4,
    classStart: 1,
    activeClass: 1,
    agentMode: 'pipeline',
    agentRole: 'collaborative',
    feedbackConditionId: 'no_corrective',
    sessionPurpose: 'practice',
    realtimeResetting: true,
  });
  assert.equal(calls.renames.length, 1);
});

test('readSettings fails in production when Supabase is not configured', async () => {
  const { readSettings } = loadSettingsStore({
    hasSupabaseAdminEnv: false,
    nodeEnv: 'production',
  });

  await assert.rejects(
    () => readSettings(),
    (error) =>
      error.name === 'SettingsStoreError' &&
      error.code === 'supabase_not_configured' &&
      error.status === 503
  );
});

test('readSettings fails in production when Supabase read fails', async () => {
  const { readSettings } = loadSettingsStore({
    nodeEnv: 'production',
    readError: new Error('database unavailable'),
  });

  await assert.rejects(
    () => readSettings(),
    (error) =>
      error.name === 'SettingsStoreError' &&
      error.code === 'settings_read_failed' &&
      error.status === 503
  );
});
