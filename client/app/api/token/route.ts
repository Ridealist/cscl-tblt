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
  EvaluationPromptSourceError,
  readEvaluationPromptState,
} from '@/lib/evaluation-prompt-source';
import {
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimePromptMetadata,
} from '@/lib/realtime-prompt-config';
import {
  RealtimePromptStoreError,
  readActiveRealtimePromptVersion,
} from '@/lib/realtime-prompt-store';
import {
  type ActivityType,
  type SessionPurpose,
  getActivityTypeForSessionPurpose,
  getSessionPurposeForActivity,
} from '@/lib/session-activity';
import { type AppSettings, SettingsStoreError, readSettings } from '@/lib/settings-store';
import { studentDefaultDisplayName } from '@/lib/student';
import { type StudentSession, getStudentSession } from '@/lib/student-auth';

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
  sessionPurpose: SessionPurpose;
  realtimeResetting: boolean;
};

type RealtimePromptSnapshot = RealtimePromptMetadata & {
  feedbackConditionId?: string;
  promptVersionId?: string;
  taskCardId?: string;
};

type StudentTokenContext = {
  displayName: string;
  student: StudentSession;
};

type SessionActivityContext = {
  activityType: ActivityType;
  evaluationCharacter?: string;
  evaluationId?: string;
  evaluationPromptId?: string;
  evaluationPromptVersion?: string;
  evaluationPromptVersionId?: string;
  promptSavedAt?: string | null;
  promptSource?: string;
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

    const student = await getStudentSession();
    if (!student) {
      return NextResponse.json(
        { error: '학생 로그인이 필요합니다.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const displayName =
      typeof body?.display_name === 'string' && body.display_name.trim()
        ? body.display_name.trim()
        : studentDefaultDisplayName(student);
    const roomName = typeof body?.room_name === 'string' ? body.room_name.trim() : '';
    if (!displayName || !roomName) {
      return NextResponse.json(
        { error: 'display_name and room_name are required.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const participantIdentity = createStudentParticipantIdentity(student);
    const config = await readRuntimeConfig();
    const agentMode = inferAgentMode(body?.agent_mode, roomName, config.agentMode);
    const sessionActivity =
      agentMode === 'realtime'
        ? await readSessionActivityContext(body, roomName, config.sessionPurpose)
        : undefined;
    if (agentMode === 'realtime' && config.realtimeResetting) {
      logTokenEvent('rejected realtime token during reset', {
        roomName,
        studentNumber: student.studentNumber,
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
        ? await readRealtimePromptSnapshot()
        : undefined;
    const roomConfig = buildRoomConfig(
      roomName,
      agentName,
      agentMode,
      config.agentRole,
      config.feedbackConditionId,
      promptSnapshot,
      { displayName, student },
      sessionActivity
    );
    const roomMetadata = JSON.parse(roomConfig.metadata);
    const requestedAgents = roomConfig.agents.map((agent) => ({
      agentName: agent.agentName,
      metadata: safeParseJson(agent.metadata),
    }));

    logTokenEvent('issuing participant token', {
      roomName,
      displayName,
      studentId: student.id,
      studentNumber: student.studentNumber,
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
      { identity: participantIdentity, name: displayName },
      roomName,
      roomConfig
    );
    if (agentMode === 'pipeline') {
      await ensureAgentDispatchRoom(roomName, agentName, roomConfig);
    } else {
      logTokenEvent('using token roomConfig for realtime agent dispatch', {
        roomName,
        agentName,
        sessionActivity: sessionActivity ?? null,
      });
    }

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantName: displayName,
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

    if (
      error instanceof SettingsStoreError ||
      error instanceof RealtimePromptStoreError ||
      error instanceof EvaluationPromptSourceError
    ) {
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

function safeIdentityPart(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 64) || 'student'
  );
}

function createStudentParticipantIdentity(student: StudentSession) {
  return `student-${safeIdentityPart(student.studentNumber)}-${Math.floor(Math.random() * 10_000)}`;
}

async function readRuntimeConfig(): Promise<RuntimeConfig> {
  const settings: AppSettings = await readSettings();
  return {
    agentMode: settings.agentMode,
    agentRole: settings.agentRole,
    feedbackConditionId: settings.feedbackConditionId,
    sessionPurpose: settings.sessionPurpose,
    realtimeResetting: settings.realtimeResetting,
  };
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
    evaluationPromptVersionId: evaluationPrompt.promptVersionId ?? undefined,
    promptSavedAt: evaluationPrompt.savedAt,
    promptSource: evaluationPrompt.usingDefault ? 'evaluation' : 'custom',
    sessionPurpose,
  };
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
  promptSnapshot?: RealtimePromptSnapshot,
  studentContext?: StudentTokenContext,
  sessionActivity?: SessionActivityContext
): RoomConfiguration {
  const studentMetadata = studentContext
    ? {
        studentId: studentContext.student.id,
        studentNumber: studentContext.student.studentNumber,
        studentName: studentContext.student.name,
        studentDisplayName: studentContext.displayName,
        studentClassNumber: studentContext.student.classNumber,
        studentRollNumber: studentContext.student.rollNumber,
      }
    : {};
  const metadata = JSON.stringify({
    agentMode,
    ...studentMetadata,
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
                ...(sessionActivity.evaluationPromptVersionId
                  ? { promptVersionId: sessionActivity.evaluationPromptVersionId }
                  : {}),
                ...(sessionActivity.promptSavedAt
                  ? { promptSavedAt: sessionActivity.promptSavedAt }
                  : {}),
                promptSource: sessionActivity.promptSource ?? 'evaluation',
              }
            : {
                agentRole,
                promptId: promptSnapshot?.promptId ?? DEFAULT_REALTIME_PROMPT_METADATA.promptId,
                ...(promptSnapshot?.promptVersionId
                  ? { promptVersionId: promptSnapshot.promptVersionId }
                  : {}),
                promptSavedAt: promptSnapshot?.savedAt ?? DEFAULT_REALTIME_PROMPT_METADATA.savedAt,
                promptSource: promptSnapshot?.source ?? DEFAULT_REALTIME_PROMPT_METADATA.source,
                feedbackConditionId,
                ...(promptSnapshot?.taskCardId ? { taskCardId: promptSnapshot.taskCardId } : {}),
              }),
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

function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'already_exists' || /already exists|already_exists|exists/i.test(error.message);
}

async function ensureAgentDispatchRoom(
  roomName: string,
  agentName: string,
  roomConfig: RoomConfiguration
): Promise<void> {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
    throw new Error('LiveKit credentials are not configured.');
  }
  const roomSvc = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const roomOptions: Parameters<RoomServiceClient['createRoom']>[0] = {
    name: roomName,
    metadata: roomConfig.metadata,
  };

  try {
    await roomSvc.createRoom(roomOptions);
    logTokenEvent('created room before agent dispatch', {
      roomName,
      agentName,
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
    logTokenEvent('room already exists before agent dispatch', {
      roomName,
      agentName,
    });
  }

  const dispatchClient = new AgentDispatchClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const dispatches = await dispatchClient.listDispatch(roomName).catch(() => []);
  const hasDispatch = dispatches.some((dispatch) => dispatch.agentName === agentName);
  if (hasDispatch) {
    logTokenEvent('agent dispatch already exists', { roomName, agentName });
    return;
  }

  try {
    await dispatchClient.createDispatch(roomName, agentName, {
      metadata: roomConfig.agents[0]?.metadata || roomConfig.metadata,
    });
    logTokenEvent('created explicit agent dispatch', { roomName, agentName });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      logTokenEvent('agent dispatch already exists after create attempt', { roomName, agentName });
      return;
    }
    throw error;
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  roomConfig: RoomConfiguration
): Promise<string> {
  if (!API_KEY || !API_SECRET) {
    throw new Error('LiveKit credentials are not configured.');
  }
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
