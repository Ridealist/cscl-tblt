import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { join } from 'path';
import { RoomConfiguration } from '@livekit/protocol';
import { type AgentMode, normalizeAgentMode } from '@/lib/agent-mode';
import {
  type AgentRole,
  DEFAULT_AGENT_ROLE,
  getAgentNameForConfig,
  normalizeAgentRole,
} from '@/lib/agent-role';
import {
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimePromptMetadata,
  validateRealtimePromptConfig,
} from '@/lib/realtime-prompt-config';

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
const STUDENT_ACCESS_CODE = process.env.STUDENT_ACCESS_CODE;
const CONFIG_PATH = join(process.cwd(), '..', 'config.json');
const PROMPT_CONFIG_PATH = join(process.cwd(), '..', 'prompt_config.json');

type RuntimeConfig = {
  agentMode: AgentMode;
  agentRole: AgentRole;
  realtimeResetting: boolean;
};

type RealtimePromptSnapshot = RealtimePromptMetadata;

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
    const accessResult = validateStudentAccessCode(body?.access_code);
    if (!accessResult.ok) {
      return NextResponse.json(
        { error: accessResult.error },
        { status: accessResult.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Use provided name/room or fall back to random values
    const participantName = body?.participant_name?.trim() || 'user';
    const participantIdentity = `${participantName}_${Math.floor(Math.random() * 10_000)}`;
    const roomName = body?.room_name?.trim() || `room_${Math.floor(Math.random() * 10_000)}`;
    const config = readRuntimeConfig();
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
    const promptSnapshot = agentMode === 'realtime' ? readRealtimePromptSnapshot() : undefined;
    const roomConfig = buildRoomConfig(agentName, agentMode, config.agentRole, promptSnapshot);
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

function validateStudentAccessCode(
  value: unknown
): { ok: true } | { ok: false; error: string; status: number } {
  if (!STUDENT_ACCESS_CODE) {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true };
    }

    return {
      ok: false,
      error: '학생 입장 코드가 설정되어 있지 않습니다.',
      status: 503,
    };
  }

  if (typeof value !== 'string' || value.trim() !== STUDENT_ACCESS_CODE) {
    return {
      ok: false,
      error: '입장 코드가 올바르지 않습니다.',
      status: 401,
    };
  }

  return { ok: true };
}

function readRuntimeConfig(): RuntimeConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      agentMode: normalizeAgentMode(raw.agentMode),
      agentRole: normalizeAgentRole(raw.agentRole ?? raw.agentStance),
      realtimeResetting: raw.realtimeResetting === true,
    };
  } catch {
    return {
      agentMode: 'pipeline',
      agentRole: DEFAULT_AGENT_ROLE,
      realtimeResetting: false,
    };
  }
}

function inferAgentMode(value: unknown, roomName: string, fallback: AgentMode): AgentMode {
  if (roomName.startsWith('realtime-')) return 'realtime';
  return normalizeAgentMode(value ?? fallback);
}

function readRealtimePromptSnapshot(): RealtimePromptSnapshot {
  try {
    const raw = JSON.parse(readFileSync(PROMPT_CONFIG_PATH, 'utf-8')) as { realtime?: unknown };
    const result = validateRealtimePromptConfig(raw.realtime);
    if (!result.ok || !raw.realtime || typeof raw.realtime !== 'object') {
      return DEFAULT_REALTIME_PROMPT_METADATA;
    }
    const realtime = raw.realtime as Partial<RealtimePromptMetadata>;
    return {
      promptId:
        typeof realtime.promptId === 'string' && realtime.promptId
          ? realtime.promptId
          : 'custom-unknown',
      savedAt: typeof realtime.savedAt === 'string' && realtime.savedAt ? realtime.savedAt : null,
      source: 'custom',
    };
  } catch {
    return DEFAULT_REALTIME_PROMPT_METADATA;
  }
}

function buildRoomConfig(
  agentName: string,
  agentMode: AgentMode,
  agentRole: AgentRole,
  promptSnapshot?: RealtimePromptSnapshot
): RoomConfiguration {
  const metadata = JSON.stringify({
    agentMode,
    ...(agentMode === 'realtime'
      ? {
          agentRole,
          promptId: promptSnapshot?.promptId ?? DEFAULT_REALTIME_PROMPT_METADATA.promptId,
          promptSavedAt: promptSnapshot?.savedAt ?? DEFAULT_REALTIME_PROMPT_METADATA.savedAt,
          promptSource: promptSnapshot?.source ?? DEFAULT_REALTIME_PROMPT_METADATA.source,
        }
      : {}),
  });

  return new RoomConfiguration({
    metadata,
    agents: [
      {
        agentName,
        metadata,
      },
    ],
  });
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
