import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

class SettingsStoreError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'SettingsStoreError';
    this.code = code;
    this.status = status;
  }
}

class EvaluationPromptSourceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'EvaluationPromptSourceError';
    this.status = status;
  }
}

const CUSTOM_PROMPT_VERSION = {
  promptId: '00000000-0000-4000-8000-000000000035',
  savedAt: '2026-06-12T00:00:00.000Z',
  source: 'custom',
  feedbackConditionId: 'no_corrective',
  taskCardId: 'morning_exercise_challenge',
};

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
      Headers,
      module,
      process: processMock,
      require: requireMock,
    },
    { filename: relativePath }
  );
  return module.exports;
}

function loadTokenRoute(options = {}) {
  const accessTokens = [];
  const createdRooms = [];
  const createdDispatches = [];
  const studentSession = Object.prototype.hasOwnProperty.call(options, 'studentSession')
    ? options.studentSession
    : {
        id: 'student-id-1',
        studentNumber: '20260001',
        name: '김민지',
        englishName: 'Minji Kim',
        classNumber: 9,
        rollNumber: 2,
        issuedAt: 1,
        expiresAt: 9999999999,
      };
  const processMock = {
    env: {
      LIVEKIT_API_KEY: 'test-key',
      LIVEKIT_API_SECRET: 'test-secret',
      LIVEKIT_URL: 'wss://example.livekit.cloud',
    },
  };

  class FakeAccessToken {
    constructor(apiKey, apiSecret, tokenOptions) {
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
      this.tokenOptions = tokenOptions;
      accessTokens.push(this);
    }

    addGrant(grant) {
      this.grant = grant;
    }

    set roomConfig(value) {
      this.assignedRoomConfig = value;
    }

    async toJwt() {
      return 'fake-token';
    }
  }

  class FakeRoomConfiguration {
    constructor(data = {}) {
      this.name = data.name ?? '';
      this.metadata = data.metadata ?? '';
      this.agents = data.agents ?? [];
    }
  }

  class FakeRoomServiceClient {
    constructor(livekitUrl, apiKey, apiSecret) {
      this.livekitUrl = livekitUrl;
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
    }

    async createRoom(roomOptions) {
      createdRooms.push(roomOptions);
      if (options.roomAlreadyExists) {
        const error = new Error('room already exists');
        error.code = 'already_exists';
        throw error;
      }
      return roomOptions;
    }
  }

  class FakeAgentDispatchClient {
    constructor(livekitUrl, apiKey, apiSecret) {
      this.livekitUrl = livekitUrl;
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
    }

    async listDispatch(roomName) {
      if (options.existingDispatchAgentName) {
        return [{ roomName, agentName: options.existingDispatchAgentName }];
      }
      return [];
    }

    async createDispatch(roomName, agentName, options) {
      createdDispatches.push({ roomName, agentName, options });
      return { roomName, agentName, metadata: options?.metadata };
    }
  }

  const exports = loadModule(
    'app/api/token/route.ts',
    (specifier) => {
      if (specifier === 'next/server') {
        return { NextResponse: FakeNextResponse };
      }
      if (specifier === 'livekit-server-sdk') {
        return {
          AccessToken: FakeAccessToken,
          AgentDispatchClient: FakeAgentDispatchClient,
          RoomServiceClient: FakeRoomServiceClient,
        };
      }
      if (specifier === '@livekit/protocol') {
        return { RoomConfiguration: FakeRoomConfiguration };
      }
      if (specifier === '@/lib/agent-mode') {
        return {
          normalizeAgentMode: (value) => (value === 'realtime' ? 'realtime' : 'pipeline'),
        };
      }
      if (specifier === '@/lib/agent-role') {
        return {
          getAgentNameForConfig: (mode) =>
            mode === 'realtime' ? 'realtime-agent' : 'pipeline-agent',
        };
      }
      if (specifier === '@/lib/realtime-prompt-config') {
        return {
          DEFAULT_REALTIME_PROMPT_METADATA: {
            promptId: 'default',
            savedAt: null,
            source: 'default',
          },
        };
      }
      if (specifier === '@/lib/realtime-prompt-store') {
        return {
          RealtimePromptStoreError,
          readActiveRealtimePromptVersion: async () => options.activePromptVersion ?? null,
        };
      }
      if (specifier === '@/lib/evaluation-prompt-source') {
        return {
          EvaluationPromptSourceError,
          readEvaluationPromptState: async ({ evaluationId } = {}) =>
            options.evaluationPromptState ?? {
              source: 'evaluation',
              usingDefault: !evaluationId,
              evaluationId: evaluationId ?? 'pretest_6_10',
              evaluationPromptId: 'pretest_6_10',
              evaluationPromptVersion: '2026-06-10',
              evaluationCharacter: 'Kate',
              openingSentence: 'Hi, I’m Kate. I just moved to Korea. Nice to meet you!',
              prompt: '# PRE-TEST INTERACTION PROMPT: Kate',
              promptVersionId: null,
              savedAt: null,
              evaluations: [],
            },
        };
      }
      if (specifier === '@/lib/session-activity') {
        return {
          getActivityTypeForSessionPurpose: (sessionPurpose) =>
            sessionPurpose === 'evaluation' ? 'free_conversation' : 'task_solution',
          getSessionPurposeForActivity: (activityType) =>
            activityType === 'free_conversation' ? 'evaluation' : 'practice',
          normalizeActivityType: (value) =>
            value === 'free_conversation' ? 'free_conversation' : 'task_solution',
          normalizeSessionPurpose: (value, activityType) =>
            value === 'evaluation' || activityType === 'free_conversation'
              ? 'evaluation'
              : 'practice',
        };
      }
      if (specifier === '@/lib/settings-store') {
        return {
          SettingsStoreError,
          readSettings: async () => ({
            numClasses: 4,
            numGroupsPerClass: 4,
            classStart: 1,
            activeClass: 1,
            agentMode: 'realtime',
            agentRole: 'dominant',
            feedbackConditionId: 'no_corrective',
            sessionPurpose: options.sessionPurpose ?? 'practice',
            realtimeResetting: false,
          }),
        };
      }
      if (specifier === '@/lib/student-auth') {
        return {
          getStudentSession: async () => studentSession,
        };
      }
      if (specifier === '@/lib/student') {
        return {
          studentDefaultDisplayName: (student) => student.englishName || student.name,
        };
      }
      return require(specifier);
    },
    processMock
  );

  return { exports, accessTokens, createdDispatches, createdRooms };
}

test('token route creates a named realtime room config for token-based agent dispatch', async () => {
  const { exports, accessTokens, createdDispatches, createdRooms } = loadTokenRoute({
    activePromptVersion: CUSTOM_PROMPT_VERSION,
  });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'realtime-debug-room',
      agent_mode: 'realtime',
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.participantToken, 'fake-token');
  assert.equal(response.jsonBody.participantName, 'Debug User');

  const token = accessTokens[0];
  assert.match(token.tokenOptions.identity, /^student-20260001-/);
  assert.equal(token.tokenOptions.name, 'Debug User');
  assert.equal(token.grant.room, 'realtime-debug-room');
  assert.equal(token.grant.roomCreate, true);
  assert.equal(token.grant.roomJoin, true);

  assert.equal(token.assignedRoomConfig.name, 'realtime-debug-room');
  assert.equal(token.assignedRoomConfig.agents[0].agentName, 'realtime-agent');
  const metadata = JSON.parse(token.assignedRoomConfig.agents[0].metadata);
  assert.equal(metadata.promptVersionId, CUSTOM_PROMPT_VERSION.promptId);
  assert.equal(metadata.promptSource, 'custom');
  assert.equal(metadata.sessionPurpose, 'practice');
  assert.equal(metadata.activityType, 'task_solution');
  assert.equal(metadata.studentId, 'student-id-1');
  assert.equal(metadata.studentNumber, '20260001');
  assert.equal(metadata.studentDisplayName, 'Debug User');
  assert.equal(metadata.studentClassNumber, 9);
  assert.equal(metadata.studentRollNumber, 2);

  assert.equal(createdRooms.length, 0);
  assert.equal(createdDispatches.length, 0);
});

test('token route marks eval-prefixed realtime rooms as evaluation sessions', async () => {
  const { exports, accessTokens, createdDispatches, createdRooms } = loadTokenRoute({
    activePromptVersion: CUSTOM_PROMPT_VERSION,
    evaluationPromptState: {
      source: 'evaluation',
      usingDefault: false,
      evaluationId: 'pretest_6_10',
      evaluationPromptId: 'manifest-prompt-id',
      evaluationPromptVersion: 'manifest-version-1',
      evaluationCharacter: 'Kate',
      openingSentence: 'Hi, I’m Kate. I just moved to Korea. Nice to meet you!',
      prompt: '# PRE-TEST INTERACTION PROMPT: Kate',
      promptVersionId: 'eval-version-1',
      savedAt: '2026-06-13T01:00:00.000Z',
      evaluations: [],
    },
    sessionPurpose: 'evaluation',
  });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'eval-9-minji-kim-a1b2c3d4',
      agent_mode: 'realtime',
      activity_type: 'free_conversation',
      session_purpose: 'evaluation',
      evaluation_id: 'pretest_6_10',
    }),
  });

  assert.equal(response.status, 200);

  const token = accessTokens[0];
  assert.equal(token.grant.room, 'eval-9-minji-kim-a1b2c3d4');
  assert.equal(token.assignedRoomConfig.agents[0].agentName, 'realtime-agent');
  const metadata = JSON.parse(token.assignedRoomConfig.metadata);
  assert.equal(metadata.agentMode, 'realtime');
  assert.equal(metadata.sessionPurpose, 'evaluation');
  assert.equal(metadata.activityType, 'free_conversation');
  assert.equal(metadata.evaluationCharacter, 'Kate');
  assert.equal(metadata.evaluationId, 'pretest_6_10');
  assert.equal(metadata.evaluationPromptId, 'manifest-prompt-id');
  assert.equal(metadata.evaluationPromptVersion, 'manifest-version-1');
  assert.equal(metadata.promptVersionId, 'eval-version-1');
  assert.equal(metadata.promptSavedAt, '2026-06-13T01:00:00.000Z');
  assert.equal(metadata.promptSource, 'custom');
  assert.equal(createdRooms.length, 0);
  assert.equal(createdDispatches.length, 0);
});

test('token route rejects stale eval room requests when admin purpose is practice', async () => {
  const { exports, accessTokens } = loadTokenRoute({ sessionPurpose: 'practice' });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'eval-9-minji-kim-a1b2c3d4',
      agent_mode: 'realtime',
      activity_type: 'free_conversation',
      session_purpose: 'evaluation',
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(response.jsonBody.code, 'session_purpose_mismatch');
  assert.equal(response.jsonBody.expectedSessionPurpose, 'practice');
  assert.equal(response.jsonBody.requestedSessionPurpose, 'evaluation');
  assert.match(response.jsonBody.error, /잠시 후 활동 선택 화면이 바뀌면 다시 입장해주세요/);
  assert.equal(accessTokens.length, 0);
});

test('token route rejects stale task room requests when admin purpose is evaluation', async () => {
  const { exports, accessTokens } = loadTokenRoute({ sessionPurpose: 'evaluation' });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'task-9-minji-kim-a1b2c3d4',
      agent_mode: 'realtime',
      activity_type: 'task_solution',
      session_purpose: 'practice',
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(response.jsonBody.code, 'session_purpose_mismatch');
  assert.equal(response.jsonBody.expectedSessionPurpose, 'evaluation');
  assert.equal(response.jsonBody.requestedSessionPurpose, 'practice');
  assert.equal(accessTokens.length, 0);
});

test('token route rejects realtime requests with conflicting purpose signals', async () => {
  const { exports, accessTokens } = loadTokenRoute({ sessionPurpose: 'evaluation' });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'eval-9-minji-kim-a1b2c3d4',
      agent_mode: 'realtime',
      activity_type: 'task_solution',
      session_purpose: 'evaluation',
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(response.jsonBody.code, 'session_purpose_mismatch');
  assert.equal(response.jsonBody.expectedSessionPurpose, 'evaluation');
  assert.equal(response.jsonBody.requestedSessionPurpose, 'practice');
  assert.equal(accessTokens.length, 0);
});

test('token route reports stale room purpose when room and body disagree', async () => {
  const { exports, accessTokens } = loadTokenRoute({ sessionPurpose: 'practice' });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'eval-9-minji-kim-a1b2c3d4',
      agent_mode: 'realtime',
      activity_type: 'free_conversation',
      session_purpose: 'practice',
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(response.jsonBody.code, 'session_purpose_mismatch');
  assert.equal(response.jsonBody.expectedSessionPurpose, 'practice');
  assert.equal(response.jsonBody.requestedSessionPurpose, 'evaluation');
  assert.equal(accessTokens.length, 0);
});

test('token route marks task-prefixed realtime rooms as practice sessions', async () => {
  const { exports, accessTokens, createdDispatches, createdRooms } = loadTokenRoute({
    activePromptVersion: CUSTOM_PROMPT_VERSION,
  });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'task-9-minji-kim-a1b2c3d4',
      agent_mode: 'realtime',
      activity_type: 'task_solution',
      session_purpose: 'practice',
    }),
  });

  assert.equal(response.status, 200);

  const metadata = JSON.parse(accessTokens[0].assignedRoomConfig.metadata);
  assert.equal(metadata.agentMode, 'realtime');
  assert.equal(metadata.sessionPurpose, 'practice');
  assert.equal(metadata.activityType, 'task_solution');
  assert.equal(metadata.promptVersionId, CUSTOM_PROMPT_VERSION.promptId);
  assert.equal(metadata.promptSource, 'custom');
  assert.equal(metadata.taskCardId, CUSTOM_PROMPT_VERSION.taskCardId);
  assert.equal(createdRooms.length, 0);
  assert.equal(createdDispatches.length, 0);
});

test('token route explicitly dispatches the pipeline agent for pipeline rooms', async () => {
  const { exports, accessTokens, createdDispatches, createdRooms } = loadTokenRoute();

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: '1반-1그룹',
      agent_mode: 'pipeline',
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.participantName, 'Debug User');

  const token = accessTokens[0];
  assert.match(token.tokenOptions.identity, /^student-20260001-/);
  assert.equal(token.assignedRoomConfig.agents[0].agentName, 'pipeline-agent');
  const metadata = JSON.parse(token.assignedRoomConfig.metadata);
  assert.equal(metadata.agentMode, 'pipeline');
  assert.equal(metadata.studentId, 'student-id-1');
  assert.equal(metadata.studentNumber, '20260001');
  assert.equal(metadata.studentDisplayName, 'Debug User');
  assert.equal(metadata.studentClassNumber, 9);
  assert.equal(metadata.studentRollNumber, 2);
  assert.equal(createdRooms.length, 1);
  assert.equal(createdRooms[0].name, '1반-1그룹');
  assert.equal(createdDispatches.length, 1);
  assert.equal(createdDispatches[0].roomName, '1반-1그룹');
  assert.equal(createdDispatches[0].agentName, 'pipeline-agent');
  assert.deepEqual(JSON.parse(createdDispatches[0].options.metadata), metadata);
});

test('token route rejects requests without a student session', async () => {
  const { exports, accessTokens } = loadTokenRoute({ studentSession: null });

  const response = await exports.POST({
    json: async () => ({
      display_name: 'Debug User',
      room_name: 'realtime-debug-room',
      agent_mode: 'realtime',
    }),
  });

  assert.equal(response.status, 401);
  assert.equal(response.jsonBody.error, '학생 로그인이 필요합니다.');
  assert.equal(accessTokens.length, 0);
});
