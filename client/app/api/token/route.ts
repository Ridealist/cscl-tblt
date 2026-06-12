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
  EvaluationPromptSourceError,
  readEvaluationPromptState,
} from '@/lib/evaluation-prompt-source';
import {
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimePromptMetadata,
} from '@/lib/realtime-prompt-config';
import {
  type ActivityType,
  type SessionPurpose,
  getActivityTypeForSessionPurpose,
  getSessionPurposeForActivity,
  normalizeSessionPurpose,
} from '@/lib/session-activity';

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
const CONFIG_PATH = join(process.cwd(), '..', 'config.json');
const PROMPT_CONFIG_PATH = join(process.cwd(), '..', 'prompt_config.json');
const DEFAULT_FEEDBACK_CONDITION_ID = 'no_corrective';

type RuntimeConfig = {
  agentMode: AgentMode;
  agentRole: AgentRole;
  feedbackConditionId: string;
  sessionPurpose: SessionPurpose;
  realtimeResetting: boolean;
};

type RealtimePromptSnapshot = RealtimePromptMetadata & {
  taskCardId?: string;
};

type SessionActivityContext = {
  activityType: ActivityType;
  evaluationCharacter?: string;
  evaluationId?: string;
  evaluationPromptId?: string;
  evaluationPromptVersion?: string;
  sessionPurpose: SessionPurpose;
};

class SessionPurposeMismatchError extends Error {
  expectedSessionPurpose: SessionPurpose;
  requestedSessionPurpose: SessionPurpose;

  constructor({
    expectedSessionPurpose,
    requestedSessionPurpose,
  }: {
    expectedSessionPurpose: SessionPurpose;
    requestedSessionPurpose: SessionPurpose;
  }) {
    super(
      '선생님이 활동 설정을 바꾸는 중입니다. 잠시 후 활동 선택 화면이 바뀌면 다시 입장해주세요.'
    );
    this.name = 'SessionPurposeMismatchError';
    this.expectedSessionPurpose = expectedSessionPurpose;
    this.requestedSessionPurpose = requestedSessionPurpose;
  }
}

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

    const body = (await req.json()) as Record<string, unknown>;

    // Use provided name/room or fall back to random values
    const participantName = text(body?.participant_name) ?? 'user';
    const participantIdentity = `${participantName}_${Math.floor(Math.random() * 10_000)}`;
    const roomName = text(body?.room_name) ?? `room_${Math.floor(Math.random() * 10_000)}`;
    const config = readRuntimeConfig();
    const agentMode = inferAgentMode(body?.agent_mode, roomName, config.agentMode);
    const sessionActivity =
      agentMode === 'realtime'
        ? await readSessionActivityContext(body, roomName, config.sessionPurpose)
        : undefined;
    if (agentMode === 'realtime' && config.realtimeResetting) {
      logTokenEvent('rejected realtime token during reset', {
        roomName,
        participantName,
        requestedAgentMode: body?.agent_mode ?? null,
        requestedActivityType: body?.activity_type ?? null,
        requestedSessionPurpose: body?.session_purpose ?? null,
      });
      return NextResponse.json(
        { error: '개별 세션 초기화 중입니다. 잠시 후 다시 입장해주세요.' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const agentName = getAgentNameForConfig(agentMode, config.agentRole);
    const promptSnapshot =
      agentMode === 'realtime' && sessionActivity?.sessionPurpose !== 'evaluation'
        ? readRealtimePromptSnapshot()
        : undefined;
    const roomConfig = buildRoomConfig(
      agentName,
      agentMode,
      config.agentRole,
      config.feedbackConditionId,
      promptSnapshot,
      sessionActivity
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
      requestedActivityType: body?.activity_type ?? null,
      requestedSessionPurpose: body?.session_purpose ?? null,
      inferredAgentMode: agentMode,
      sessionActivity: sessionActivity ?? null,
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
    if (error instanceof SessionPurposeMismatchError) {
      return NextResponse.json(
        {
          code: 'session_purpose_mismatch',
          error: error.message,
          expectedSessionPurpose: error.expectedSessionPurpose,
          requestedSessionPurpose: error.requestedSessionPurpose,
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (error instanceof EvaluationPromptSourceError) {
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

function readRuntimeConfig(): RuntimeConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      agentMode: normalizeAgentMode(raw.agentMode),
      agentRole: normalizeAgentRole(raw.agentRole ?? raw.agentStance),
      feedbackConditionId: normalizeFeedbackConditionId(raw.feedbackConditionId),
      sessionPurpose: normalizeSessionPurpose(raw.sessionPurpose),
      realtimeResetting: raw.realtimeResetting === true,
    };
  } catch {
    return {
      agentMode: 'pipeline',
      agentRole: DEFAULT_AGENT_ROLE,
      feedbackConditionId: DEFAULT_FEEDBACK_CONDITION_ID,
      sessionPurpose: 'practice',
      realtimeResetting: false,
    };
  }
}

function normalizeFeedbackConditionId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_FEEDBACK_CONDITION_ID;
}

function inferAgentMode(value: unknown, roomName: string, fallback: AgentMode): AgentMode {
  if (roomName.startsWith('eval-') || roomName.startsWith('task-')) return 'realtime';
  if (roomName.startsWith('realtime-')) return 'realtime';
  return normalizeAgentMode(value ?? fallback);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

type SessionPurposeSignal = {
  sessionPurpose: SessionPurpose;
  source: 'activity_type' | 'room_name' | 'session_purpose';
};

function parseRoomSessionPurpose(roomName: string): SessionPurpose | undefined {
  if (roomName.startsWith('eval-')) return 'evaluation';
  if (roomName.startsWith('task-')) return 'practice';
  return undefined;
}

function parseBodyActivityType(value: unknown): ActivityType | undefined {
  return value === 'free_conversation' || value === 'task_solution' ? value : undefined;
}

function parseBodySessionPurpose(value: unknown): SessionPurpose | undefined {
  if (value === 'evaluation') return 'evaluation';
  if (value === 'practice' || value === 'execution') return 'practice';
  return undefined;
}

function collectSessionPurposeSignals(
  body: Record<string, unknown>,
  roomName: string
): SessionPurposeSignal[] {
  const roomSessionPurpose = parseRoomSessionPurpose(roomName);
  const bodySessionPurpose = parseBodySessionPurpose(body?.session_purpose);
  const bodyActivityType = parseBodyActivityType(body?.activity_type);
  return [
    ...(roomSessionPurpose
      ? [{ source: 'room_name' as const, sessionPurpose: roomSessionPurpose }]
      : []),
    ...(bodySessionPurpose
      ? [{ source: 'session_purpose' as const, sessionPurpose: bodySessionPurpose }]
      : []),
    ...(bodyActivityType
      ? [
          {
            source: 'activity_type' as const,
            sessionPurpose: getSessionPurposeForActivity(bodyActivityType),
          },
        ]
      : []),
  ];
}

function resolveRequestedSessionPurpose(
  body: Record<string, unknown>,
  roomName: string,
  currentSessionPurpose: SessionPurpose
): SessionPurpose {
  const signals = collectSessionPurposeSignals(body, roomName);
  const firstSignal = signals[0];
  const conflictingSignal = signals.find(
    (signal) => firstSignal && signal.sessionPurpose !== firstSignal.sessionPurpose
  );

  if (firstSignal && conflictingSignal) {
    const requestedSessionPurpose =
      firstSignal.sessionPurpose !== currentSessionPurpose
        ? firstSignal.sessionPurpose
        : conflictingSignal.sessionPurpose;
    throw new SessionPurposeMismatchError({
      expectedSessionPurpose: currentSessionPurpose,
      requestedSessionPurpose,
    });
  }

  const requestedSessionPurpose = firstSignal?.sessionPurpose ?? currentSessionPurpose;
  if (requestedSessionPurpose !== currentSessionPurpose) {
    throw new SessionPurposeMismatchError({
      expectedSessionPurpose: currentSessionPurpose,
      requestedSessionPurpose,
    });
  }

  return currentSessionPurpose;
}

async function readSessionActivityContext(
  body: Record<string, unknown>,
  roomName: string,
  currentSessionPurpose: SessionPurpose
): Promise<SessionActivityContext> {
  const sessionPurpose = resolveRequestedSessionPurpose(body, roomName, currentSessionPurpose);
  const activityType = getActivityTypeForSessionPurpose(sessionPurpose);

  if (sessionPurpose !== 'evaluation') {
    return {
      activityType,
      sessionPurpose,
    };
  }

  const evaluationPrompt = await readEvaluationPromptState({
    evaluationId: text(body?.evaluation_id),
  });
  return {
    activityType,
    evaluationCharacter: evaluationPrompt.evaluationCharacter,
    evaluationId: evaluationPrompt.evaluationId,
    evaluationPromptId: evaluationPrompt.evaluationPromptId,
    evaluationPromptVersion: evaluationPrompt.evaluationPromptVersion,
    sessionPurpose,
  };
}

function readRealtimePromptSnapshot(): RealtimePromptSnapshot {
  try {
    const raw = JSON.parse(readFileSync(PROMPT_CONFIG_PATH, 'utf-8')) as { realtime?: unknown };
    if (!raw.realtime || typeof raw.realtime !== 'object') {
      return DEFAULT_REALTIME_PROMPT_METADATA;
    }
    const realtime = raw.realtime as Partial<RealtimePromptMetadata> & {
      taskCardId?: unknown;
    };
    return {
      promptId:
        typeof realtime.promptId === 'string' && realtime.promptId
          ? realtime.promptId
          : 'custom-unknown',
      savedAt: typeof realtime.savedAt === 'string' && realtime.savedAt ? realtime.savedAt : null,
      source: 'custom',
      taskCardId:
        typeof realtime.taskCardId === 'string' && realtime.taskCardId
          ? realtime.taskCardId
          : undefined,
    };
  } catch {
    return DEFAULT_REALTIME_PROMPT_METADATA;
  }
}

function buildRoomConfig(
  agentName: string,
  agentMode: AgentMode,
  agentRole: AgentRole,
  feedbackConditionId: string,
  promptSnapshot?: RealtimePromptSnapshot,
  sessionActivity?: SessionActivityContext
): RoomConfiguration {
  const metadata = JSON.stringify({
    agentMode,
    ...(agentMode === 'realtime'
      ? {
          sessionPurpose: sessionActivity?.sessionPurpose ?? 'practice',
          activityType: sessionActivity?.activityType ?? 'task_solution',
          ...(sessionActivity?.sessionPurpose === 'evaluation'
            ? {
                evaluationCharacter: sessionActivity.evaluationCharacter,
                evaluationId: sessionActivity.evaluationId,
                evaluationPromptId: sessionActivity.evaluationPromptId,
                evaluationPromptVersion: sessionActivity.evaluationPromptVersion,
              }
            : {
                agentRole,
                promptId: promptSnapshot?.promptId ?? DEFAULT_REALTIME_PROMPT_METADATA.promptId,
                promptSavedAt: promptSnapshot?.savedAt ?? DEFAULT_REALTIME_PROMPT_METADATA.savedAt,
                promptSource: promptSnapshot?.source ?? DEFAULT_REALTIME_PROMPT_METADATA.source,
                feedbackConditionId,
                ...(promptSnapshot?.taskCardId ? { taskCardId: promptSnapshot.taskCardId } : {}),
              }),
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
