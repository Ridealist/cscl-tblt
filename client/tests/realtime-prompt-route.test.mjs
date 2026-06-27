import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

class FakeNextResponse {
  constructor(body = null, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
  }

  static json(data, init = {}) {
    const response = new FakeNextResponse(JSON.stringify(data), { status: init.status ?? 200 });
    response.jsonBody = data;
    return response;
  }
}

class RealtimePromptStoreError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'RealtimePromptStoreError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_REALTIME_PROMPT_METADATA = {
  promptId: 'default',
  savedAt: null,
  source: 'default',
};

const EMPTY_CONDITION_COMBINATION_PROMPTS = {
  dominant_no_feedback: '',
  dominant_explicit_correction: '',
  collaborative_no_feedback: '',
  collaborative_explicit_correction: '',
};

const CUSTOM_CONDITION_COMBINATION_PROMPTS = {
  dominant_no_feedback: 'Dominant no feedback condition prompt.',
  dominant_explicit_correction: 'Dominant explicit correction condition prompt.',
  collaborative_no_feedback: 'Collaborative no feedback condition prompt.',
  collaborative_explicit_correction: 'Collaborative explicit correction condition prompt.',
};

const DEFAULT_CONDITION_COMBINATION_PROMPTS = {
  dominant_no_feedback:
    '# CONDITION COMBINATION PROMPT: Dominant + No Feedback\nDefault dominant no-feedback condition prompt.',
  dominant_explicit_correction:
    '# CONDITION COMBINATION PROMPT: Dominant + Explicit Correction\nDefault dominant explicit condition prompt.',
  collaborative_no_feedback:
    '# CONDITION COMBINATION PROMPT: Collaborative + No Feedback\nDefault collaborative no-feedback condition prompt.',
  collaborative_explicit_correction:
    '# CONDITION COMBINATION PROMPT: Collaborative + Explicit Correction\nDefault collaborative explicit condition prompt.',
};

const DEFAULT_PROMPT = {
  basePrompt: '# BASE PROMPT:\nDefault base prompt',
  dominantPrompt: '# INTERLOCUTOR ROLE PROMPT: Dominant\nDefault dominant prompt',
  collaborativePrompt: '# INTERLOCUTOR ROLE PROMPT: Collaborative\nDefault collaborative prompt',
  feedbackConditionId: 'explicit_correction',
  feedbackPrompt: '# FEEDBACK CONDITION: Explicit Correction\nDefault explicit feedback',
  conditionCombinationPrompts: DEFAULT_CONDITION_COMBINATION_PROMPTS,
  taskCardId: 'special_activity_plan',
  taskCardPrompt: '# TASK CARD: Our Class Special Activity Plan\nDefault special task card',
};

const SCHOOL_EVENT_TASK_CARD_PROMPT =
  '# TASK CARD: School Event Invitation\nDefault school task card';

const CUSTOM_PROMPT = {
  basePrompt: '# BASE PROMPT:\nEdited base prompt',
  dominantPrompt: '# INTERLOCUTOR ROLE PROMPT: Dominant\nEdited dominant prompt',
  collaborativePrompt: '# INTERLOCUTOR ROLE PROMPT: Collaborative\nEdited collaborative prompt',
  feedbackConditionId: 'explicit_correction',
  feedbackPrompt: '# FEEDBACK CONDITION: Explicit Correction\nEdited feedback prompt',
  conditionCombinationPrompts: CUSTOM_CONDITION_COMBINATION_PROMPTS,
  taskCardId: 'school_event_invitation',
  taskCardPrompt: '# TASK CARD: School Event Invitation\nEdited task card prompt',
};

const CUSTOM_VERSION = {
  ...CUSTOM_PROMPT,
  promptId: '00000000-0000-4000-8000-000000000034',
  savedAt: '2026-06-12T00:00:00.000Z',
  source: 'custom',
  createdBy: 'admin-user',
  hash: 'hash-custom',
  isActive: true,
  label: 'Custom practice',
};

const FILES = new Map(
  Object.entries({
    '/repo/prompts/realtime/manifest.json': JSON.stringify({
      basePrompt: { file: 'base.md', marker: '# BASE PROMPT:' },
      dominantPrompt: {
        file: 'roles/dominant.md',
        marker: '# INTERLOCUTOR ROLE PROMPT: Dominant',
      },
      collaborativePrompt: {
        file: 'roles/collaborative.md',
        marker: '# INTERLOCUTOR ROLE PROMPT: Collaborative',
      },
      feedbackConditionManifest: 'feedbacks/manifest.json',
      defaultFeedbackConditionId: 'no_corrective',
      conditionCombinationManifest: 'condition-combinations/manifest.json',
      taskCardManifest: 'task-cards/manifest.json',
      defaultTaskCardId: 'special_activity_plan',
    }),
    '/repo/prompts/realtime/base.md': DEFAULT_PROMPT.basePrompt,
    '/repo/prompts/realtime/roles/dominant.md': DEFAULT_PROMPT.dominantPrompt,
    '/repo/prompts/realtime/roles/collaborative.md': DEFAULT_PROMPT.collaborativePrompt,
    '/repo/prompts/realtime/feedbacks/manifest.json': JSON.stringify({
      no_corrective: {
        file: 'no_corrective.md',
        title: 'No Feedback',
        marker: '# FEEDBACK CONDITION: No Feedback',
      },
      explicit_correction: {
        file: 'explicit_correction.md',
        title: 'Explicit Correction',
        marker: '# FEEDBACK CONDITION: Explicit Correction',
      },
    }),
    '/repo/prompts/realtime/feedbacks/no_corrective.md':
      '# FEEDBACK CONDITION: No Feedback\nDefault no-feedback feedback',
    '/repo/prompts/realtime/feedbacks/explicit_correction.md': DEFAULT_PROMPT.feedbackPrompt,
    '/repo/prompts/realtime/condition-combinations/manifest.json': JSON.stringify({
      dominant_no_feedback: {
        file: 'dominant_no_feedback.md',
        title: 'Dominant - No Feedback',
        marker: '# CONDITION COMBINATION PROMPT: Dominant + No Feedback',
      },
      dominant_explicit_correction: {
        file: 'dominant_explicit_correction.md',
        title: 'Dominant - Explicit Correction',
        marker: '# CONDITION COMBINATION PROMPT: Dominant + Explicit Correction',
      },
      collaborative_no_feedback: {
        file: 'collaborative_no_feedback.md',
        title: 'Collaborative - No Feedback',
        marker: '# CONDITION COMBINATION PROMPT: Collaborative + No Feedback',
      },
      collaborative_explicit_correction: {
        file: 'collaborative_explicit_correction.md',
        title: 'Collaborative - Explicit Correction',
        marker: '# CONDITION COMBINATION PROMPT: Collaborative + Explicit Correction',
      },
    }),
    '/repo/prompts/realtime/condition-combinations/dominant_no_feedback.md':
      DEFAULT_CONDITION_COMBINATION_PROMPTS.dominant_no_feedback,
    '/repo/prompts/realtime/condition-combinations/dominant_explicit_correction.md':
      DEFAULT_CONDITION_COMBINATION_PROMPTS.dominant_explicit_correction,
    '/repo/prompts/realtime/condition-combinations/collaborative_no_feedback.md':
      DEFAULT_CONDITION_COMBINATION_PROMPTS.collaborative_no_feedback,
    '/repo/prompts/realtime/condition-combinations/collaborative_explicit_correction.md':
      DEFAULT_CONDITION_COMBINATION_PROMPTS.collaborative_explicit_correction,
    '/repo/prompts/realtime/task-cards/manifest.json': JSON.stringify({
      school_event_invitation: {
        file: 'school_event_invitation.md',
        title: 'School Event Invitation',
        topic: 'School event',
        level: 'A2',
        marker: '# TASK CARD: School Event Invitation',
      },
      special_activity_plan: {
        file: 'special_activity_plan.md',
        title: 'L5-T3. Our Class Special Activity Plan',
        topic: 'planning a special class activity',
        level: 'A1-A2',
        marker: '# TASK CARD:',
      },
    }),
    '/repo/prompts/realtime/task-cards/school_event_invitation.md': SCHOOL_EVENT_TASK_CARD_PROMPT,
    '/repo/prompts/realtime/task-cards/special_activity_plan.md': DEFAULT_PROMPT.taskCardPrompt,
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
    config: {
      ...Object.fromEntries(required.map((key) => [key, value[key].trim()])),
      conditionCombinationPrompts: {
        ...EMPTY_CONDITION_COMBINATION_PROMPTS,
        ...(value.conditionCombinationPrompts ?? {}),
      },
    },
  };
}

function loadRealtimePromptRoute(options = {}) {
  const calls = {
    activate: [],
    delete: [],
    deactivate: 0,
    list: 0,
    readActive: 0,
    readVersion: [],
    savedConfigs: [],
  };
  const processMock = {
    cwd: () => '/repo/client',
    env: {},
  };

  const exports = loadModule(
    'app/api/admin/prompts/realtime/route.ts',
    (specifier) => {
      if (specifier === 'next/server') {
        return { NextResponse: FakeNextResponse };
      }

      if (specifier === 'fs/promises') {
        return {
          readFile: async (target, encoding) => {
            assert.equal(encoding, 'utf-8');
            const normalized = path.posix.normalize(target);
            if (!FILES.has(normalized)) {
              throw new Error(`Missing prompt fixture: ${normalized}`);
            }
            return FILES.get(normalized);
          },
        };
      }

      if (specifier === 'path') {
        return path;
      }

      if (specifier === '@/lib/realtime-prompt-config') {
        return {
          CONDITION_COMBINATION_PROMPT_KEYS: Object.keys(EMPTY_CONDITION_COMBINATION_PROMPTS),
          DEFAULT_REALTIME_PROMPT_METADATA,
          validateRealtimePromptConfig,
        };
      }

      if (specifier === '@/lib/realtime-prompt-store') {
        return {
          RealtimePromptStoreError,
          activateRealtimePromptVersion: async (versionId) => {
            calls.activate.push(versionId);
            return options.activeVersion ?? CUSTOM_VERSION;
          },
          deactivateActiveRealtimePromptVersion: async () => {
            calls.deactivate += 1;
            if (options.deactivateError) throw options.deactivateError;
          },
          deleteRealtimePromptVersion: async (versionId) => {
            calls.delete.push(versionId);
            if (options.deleteError) throw options.deleteError;
          },
          listRealtimePromptVersions: async () => {
            calls.list += 1;
            return (
              options.promptVersions ?? [
                {
                  id: CUSTOM_VERSION.promptId,
                  label: CUSTOM_VERSION.label,
                  createdAt: CUSTOM_VERSION.savedAt,
                  hash: CUSTOM_VERSION.hash,
                  taskCardId: CUSTOM_VERSION.taskCardId,
                },
              ]
            );
          },
          readActiveRealtimePromptVersion: async () => {
            calls.readActive += 1;
            if (options.readActiveError) throw options.readActiveError;
            return options.activeVersion ?? null;
          },
          readRealtimePromptVersion: async (versionId) => {
            calls.readVersion.push(versionId);
            return options.readVersion ?? null;
          },
          saveRealtimePromptVersion: async (config, saveOptions) => {
            calls.savedConfigs.push({ config, options: saveOptions });
            if (options.saveError) throw options.saveError;
            return {
              ...config,
              promptId: '00000000-0000-4000-8000-000000000034',
              savedAt: '2026-06-12T00:00:00.000Z',
              source: 'custom',
              createdBy: saveOptions.createdBy,
              hash: 'hash-custom',
              isActive: true,
              label: saveOptions.label ?? 'Custom practice',
            };
          },
        };
      }

      if (specifier === '@/lib/settings-store') {
        return {
          readSettings: async () => ({
            feedbackConditionId: options.runtimeFeedbackConditionId ?? 'explicit_correction',
          }),
        };
      }

      if (specifier === '@/lib/supabase/admin-auth') {
        return {
          getAdminAuthResult: async () =>
            options.authResult ?? { ok: true, user: { id: 'admin-user' } },
          requireAdmin: async () => options.adminError ?? null,
        };
      }

      throw new Error(`Unexpected import in realtime prompt route test: ${specifier}`);
    },
    processMock
  );

  return { ...exports, calls };
}

function postRequest(body) {
  return {
    json: async () => body,
  };
}

function promptFields(value) {
  return {
    basePrompt: value.basePrompt,
    dominantPrompt: value.dominantPrompt,
    collaborativePrompt: value.collaborativePrompt,
    feedbackConditionId: value.feedbackConditionId,
    feedbackPrompt: value.feedbackPrompt,
    conditionCombinationPrompts: value.conditionCombinationPrompts,
    taskCardId: value.taskCardId,
    taskCardPrompt: value.taskCardPrompt,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('GET returns active Supabase prompt version without leaking internal row fields', async () => {
  const { GET, calls } = loadRealtimePromptRoute({ activeVersion: CUSTOM_VERSION });

  const response = await GET();

  assert.equal(response.status, 200);
  assert.equal(calls.readActive, 1);
  assert.equal(response.jsonBody.usingDefault, false);
  assert.deepEqual(promptFields(response.jsonBody), CUSTOM_PROMPT);
  assert.equal(response.jsonBody.promptId, CUSTOM_VERSION.promptId);
  assert.equal(response.jsonBody.promptVersions[0].taskCardId, CUSTOM_VERSION.taskCardId);
  assert.equal(response.jsonBody.savedAt, CUSTOM_VERSION.savedAt);
  assert.equal(response.jsonBody.source, 'custom');
  assert.equal('isActive' in response.jsonBody, false);
  assert.equal('createdBy' in response.jsonBody, false);
});

test('GET returns tracked markdown defaults when no active prompt version exists', async () => {
  const { GET } = loadRealtimePromptRoute({ activeVersion: null });

  const response = await GET();

  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.usingDefault, true);
  assert.deepEqual(promptFields(response.jsonBody), DEFAULT_PROMPT);
  assert.deepEqual(
    {
      promptId: response.jsonBody.promptId,
      savedAt: response.jsonBody.savedAt,
      source: response.jsonBody.source,
    },
    DEFAULT_REALTIME_PROMPT_METADATA
  );
});

test('POST saves a new active version with edited condition-combination and task card prompt snapshots', async () => {
  const { POST, calls } = loadRealtimePromptRoute();

  const response = await POST(postRequest(CUSTOM_PROMPT));

  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.usingDefault, false);
  assert.deepEqual(promptFields(response.jsonBody), CUSTOM_PROMPT);
  assert.deepEqual(plain(calls.savedConfigs), [
    {
      config: CUSTOM_PROMPT,
      options: { createdBy: 'admin-user', label: null },
    },
  ]);
});

test('DELETE deactivates active custom prompt and returns tracked markdown defaults', async () => {
  const { DELETE, calls } = loadRealtimePromptRoute();

  const response = await DELETE();

  assert.equal(response.status, 200);
  assert.equal(calls.deactivate, 1);
  assert.equal(response.jsonBody.usingDefault, true);
  assert.deepEqual(promptFields(response.jsonBody), DEFAULT_PROMPT);
  assert.equal(response.jsonBody.promptId, 'default');
});
