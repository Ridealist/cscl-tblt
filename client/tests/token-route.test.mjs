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

    async createRoom(options) {
      createdRooms.push(options);
      if (options.throwAlreadyExists) {
        const error = new Error('room already exists');
        error.code = 'already_exists';
        throw error;
      }
      return options;
    }
  }

  class FakeAgentDispatchClient {
    constructor(livekitUrl, apiKey, apiSecret) {
      this.livekitUrl = livekitUrl;
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
    }

    async listDispatch() {
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
            realtimeResetting: false,
          }),
        };
      }
      return require(specifier);
    },
    processMock
  );

  return { exports, accessTokens, createdDispatches, createdRooms };
}

test('token route creates a named LiveKit room config with agent dispatch', async () => {
  const { exports, accessTokens, createdDispatches, createdRooms } = loadTokenRoute({
    activePromptVersion: CUSTOM_PROMPT_VERSION,
  });

  const response = await exports.POST({
    json: async () => ({
      participant_name: 'Debug User',
      room_name: 'realtime-debug-room',
      agent_mode: 'realtime',
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.participantToken, 'fake-token');

  const token = accessTokens[0];
  assert.equal(token.grant.room, 'realtime-debug-room');
  assert.equal(token.grant.roomCreate, true);
  assert.equal(token.grant.roomJoin, true);

  assert.equal(token.assignedRoomConfig.name, 'realtime-debug-room');
  assert.equal(token.assignedRoomConfig.agents[0].agentName, 'realtime-agent');
  const metadata = JSON.parse(token.assignedRoomConfig.agents[0].metadata);
  assert.equal(metadata.promptVersionId, CUSTOM_PROMPT_VERSION.promptId);
  assert.equal(metadata.promptSource, 'custom');

  assert.equal(createdRooms.length, 1);
  assert.equal(createdRooms[0].name, 'realtime-debug-room');
  assert.equal(createdRooms[0].agents[0].agentName, 'realtime-agent');
  assert.equal(createdDispatches.length, 0);
});
