import { NextResponse } from 'next/server';
import {
  AccessToken,
  type AccessTokenOptions,
  AgentDispatchClient,
  RoomServiceClient,
  type VideoGrant,
} from 'livekit-server-sdk';
import { RoomConfiguration } from '@livekit/protocol';
import { type AgentMode, normalizeAgentMode } from '@/lib/agent-mode';
import { type AgentRole, getAgentNameForConfig } from '@/lib/agent-role';
import {
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimePromptMetadata,
} from '@/lib/realtime-prompt-config';
import {
  RealtimePromptStoreError,
  readActiveRealtimePromptVersion,
} from '@/lib/realtime-prompt-store';
import { type AppSettings, SettingsStoreError, readSettings } from '@/lib/settings-store';

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

// NOTE: you are expected to define the following environment variables in `.env.local`:
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

type RuntimeConfig = {
  agentMode: AgentMode;
  agentRole: AgentRole;
  feedbackConditionId: string;
  realtimeResetting: boolean;
};

type RealtimePromptSnapshot = RealtimePromptMetadata & {
  feedbackConditionId?: string;
  promptVersionId?: string;
  taskCardId?: string;
};

// don't cache the results
export const revalidate = 0;

function logTokenEvent(event: string, data: Record<string, unknown>) {
  console.info(`[api/token] ${event}`, data);
}

export async function POST(req: Request) {
  try {
    if (LIVEKIT_URL === undefined) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    if (API_KEY === undefined) {
      throw new Error('LIVEKIT_API_KEY is not defined');
    }
    if (API_SECRET === undefined) {
      throw new Error('LIVEKIT_API_SECRET is not defined');
    }

    const body = await req.json();

    const participantName =
      typeof body?.participant_name === 'string' ? body.participant_name.trim() : '';
    const roomName = typeof body?.room_name === 'string' ? body.room_name.trim() : '';
    if (!participantName || !roomName) {
      return NextResponse.json(
        { error: 'participant_name and room_name are required.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const participantIdentity = `${participantName}_${Math.floor(Math.random() * 10_000)}`;
    const config = await readRuntimeConfig();
    const agentMode = inferAgentMode(body?.agent_mode, roomName, config.agentMode);
    if (agentMode === 'realtime' && config.realtimeResetting) {
      logTokenEvent('rejected realtime token during reset', {
        roomName,
        participantName,
        requestedAgentMode: body?.agent_mode ?? null,
      });
      return NextResponse.json(
        { error: '개별 세션 초기화 중입니다. 잠시 후 다시 입장해주세요.' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const agentName = getAgentNameForConfig(agentMode, config.agentRole);
    const promptSnapshot =
      agentMode === 'realtime' ? await readRealtimePromptSnapshot() : undefined;
    const roomConfig = buildRoomConfig(
      roomName,
      agentName,
      agentMode,
      config.agentRole,
      config.feedbackConditionId,
      promptSnapshot
    );
    const roomMetadata = JSON.parse(roomConfig.metadata);
    const requestedAgents = roomConfig.agents.map((agent) => ({
      agentName: agent.agentName,
      metadata: safeParseJson(agent.metadata),
    }));

    logTokenEvent('issuing participant token', {
      roomName,
      participantName,
      participantIdentity,
      requestedAgentMode: body?.agent_mode ?? null,
      inferredAgentMode: agentMode,
      runtimeAgentMode: config.agentMode,
      runtimeAgentRole: config.agentRole,
      runtimeFeedbackConditionId: config.feedbackConditionId,
      agentName,
      roomMetadata,
      requestedAgents,
      promptSnapshot: promptSnapshot ?? null,
      livekitUrlSet: Boolean(LIVEKIT_URL),
    });

    const participantToken = await createParticipantToken(
      { identity: participantIdentity, name: participantName },
      roomName,
      roomConfig
    );
    if (agentMode === 'realtime') {
      await ensureRealtimeAgentDispatchRoom(roomName, agentName, roomConfig);
    }

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantName,
      participantToken,
    };
    logTokenEvent('participant token issued', {
      roomName,
      participantIdentity,
      agentName,
    });
    const headers = new Headers({
      'Cache-Control': 'no-store',
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof SettingsStoreError || error instanceof RealtimePromptStoreError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (error instanceof Error) {
      console.error('[api/token] token issuance failed', {
        message: error.message,
        stack: error.stack,
      });
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readRuntimeConfig(): Promise<RuntimeConfig> {
  const settings: AppSettings = await readSettings();
  return {
    agentMode: settings.agentMode,
    agentRole: settings.agentRole,
    feedbackConditionId: settings.feedbackConditionId,
    realtimeResetting: settings.realtimeResetting,
  };
}

function inferAgentMode(value: unknown, roomName: string, fallback: AgentMode): AgentMode {
  if (roomName.startsWith('realtime-')) return 'realtime';
  return normalizeAgentMode(value ?? fallback);
}

async function readRealtimePromptSnapshot(): Promise<RealtimePromptSnapshot> {
  const activeVersion = await readActiveRealtimePromptVersion();
  if (!activeVersion) {
    return DEFAULT_REALTIME_PROMPT_METADATA;
  }

  return {
    promptId: activeVersion.promptId,
    promptVersionId: activeVersion.promptId,
    savedAt: activeVersion.savedAt,
    source: activeVersion.source,
    feedbackConditionId: activeVersion.feedbackConditionId,
    taskCardId: activeVersion.taskCardId,
  };
}

function buildRoomConfig(
  roomName: string,
  agentName: string,
  agentMode: AgentMode,
  agentRole: AgentRole,
  feedbackConditionId: string,
  promptSnapshot?: RealtimePromptSnapshot
): RoomConfiguration {
  const metadata = JSON.stringify({
    agentMode,
    ...(agentMode === 'realtime'
      ? {
          agentRole,
          promptId: promptSnapshot?.promptId ?? DEFAULT_REALTIME_PROMPT_METADATA.promptId,
          ...(promptSnapshot?.promptVersionId
            ? { promptVersionId: promptSnapshot.promptVersionId }
            : {}),
          promptSavedAt: promptSnapshot?.savedAt ?? DEFAULT_REALTIME_PROMPT_METADATA.savedAt,
          promptSource: promptSnapshot?.source ?? DEFAULT_REALTIME_PROMPT_METADATA.source,
          feedbackConditionId: promptSnapshot?.feedbackConditionId ?? feedbackConditionId,
          ...(promptSnapshot?.taskCardId ? { taskCardId: promptSnapshot.taskCardId } : {}),
        }
      : {}),
  });

  return new RoomConfiguration({
    name: roomName,
    metadata,
    agents: [
      {
        agentName,
        metadata,
      },
    ],
  });
}

type RoomCreateOptionsWithAgents = Parameters<RoomServiceClient['createRoom']>[0] & {
  agents?: RoomConfiguration['agents'];
};

function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'already_exists' || /already exists|already_exists|exists/i.test(error.message);
}

async function ensureRealtimeAgentDispatchRoom(
  roomName: string,
  agentName: string,
  roomConfig: RoomConfiguration
): Promise<void> {
  const roomSvc = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const roomOptions: RoomCreateOptionsWithAgents = {
    name: roomName,
    metadata: roomConfig.metadata,
    agents: roomConfig.agents,
  };

  try {
    await roomSvc.createRoom(roomOptions);
    logTokenEvent('created realtime room with agent dispatch', {
      roomName,
      agentName,
      requestedAgents: roomConfig.agents.map((agent) => ({ agentName: agent.agentName })),
    });
    return;
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
    logTokenEvent('realtime room already exists before token join', {
      roomName,
      agentName,
    });
  }

  const dispatchClient = new AgentDispatchClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const dispatches = await dispatchClient.listDispatch(roomName).catch(() => []);
  const hasDispatch = dispatches.some((dispatch) => dispatch.agentName === agentName);
  if (hasDispatch) {
    logTokenEvent('realtime agent dispatch already exists', { roomName, agentName });
    return;
  }

  await dispatchClient.createDispatch(roomName, agentName, {
    metadata: roomConfig.agents[0]?.metadata || roomConfig.metadata,
  });
  logTokenEvent('created explicit realtime agent dispatch', { roomName, agentName });
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  roomConfig: RoomConfiguration
): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    ...userInfo,
    ttl: '15m',
  });
  const grant: VideoGrant = {
    room: roomName,
    roomCreate: true,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);

  if (roomConfig) {
    at.roomConfig = roomConfig;
  }

  return at.toJwt();
}
