import { NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { JACK_CHARACTER, KATE_CHARACTER } from '@/lib/agent-character';
import { type AgentRole, normalizeAgentRole } from '@/lib/agent-role';
import { readRealtimeTaskCharacter } from '@/lib/realtime-character-source';
import type { RealtimePromptSource } from '@/lib/realtime-prompt-config';
import { readActiveRealtimePromptVersion } from '@/lib/realtime-prompt-store';
import type { ActivityType, SessionPurpose } from '@/lib/session-activity';
import { SettingsStoreError, readSettings } from '@/lib/settings-store';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RoomCounts = {
  numParticipants: number;
  totalParticipants: number;
  numAgents: number;
  numEgress: number;
};

function parseRealtimeRoomMetadata(metadata?: string): {
  activityType?: ActivityType;
  agentRole?: AgentRole;
  evaluationCharacter?: string;
  evaluationId?: string;
  evaluationPromptId?: string;
  evaluationPromptVersion?: string;
  agentCharacterId?: string;
  agentCharacterName?: string;
  agentCharacterAvatarSrc?: string;
  feedbackConditionId?: string;
  promptId?: string;
  promptVersionId?: string;
  promptSavedAt?: string | null;
  promptSource?: RealtimePromptSource;
  sessionPurpose?: SessionPurpose;
  taskCardId?: string;
} {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as {
      agentMode?: unknown;
      agentRole?: unknown;
      agentStance?: unknown;
      activityType?: unknown;
      evaluationCharacter?: unknown;
      evaluationId?: unknown;
      evaluationPromptId?: unknown;
      evaluationPromptVersion?: unknown;
      agentCharacterId?: unknown;
      agentCharacterName?: unknown;
      agentCharacterAvatarSrc?: unknown;
      feedbackConditionId?: unknown;
      promptId?: unknown;
      promptVersionId?: unknown;
      promptSavedAt?: unknown;
      promptSource?: unknown;
      sessionPurpose?: unknown;
      taskCardId?: unknown;
    };
    const rawRole = parsed.agentRole ?? parsed.agentStance;
    if (parsed.agentMode !== 'realtime') return {};
    return {
      ...(rawRole ? { agentRole: normalizeAgentRole(rawRole) } : {}),
      agentCharacterId:
        typeof parsed.agentCharacterId === 'string' ? parsed.agentCharacterId : undefined,
      agentCharacterName:
        typeof parsed.agentCharacterName === 'string' ? parsed.agentCharacterName : undefined,
      agentCharacterAvatarSrc:
        typeof parsed.agentCharacterAvatarSrc === 'string'
          ? parsed.agentCharacterAvatarSrc
          : undefined,
      activityType:
        parsed.activityType === 'free_conversation' || parsed.activityType === 'task_solution'
          ? parsed.activityType
          : undefined,
      evaluationCharacter:
        typeof parsed.evaluationCharacter === 'string' ? parsed.evaluationCharacter : undefined,
      evaluationId: typeof parsed.evaluationId === 'string' ? parsed.evaluationId : undefined,
      evaluationPromptId:
        typeof parsed.evaluationPromptId === 'string' ? parsed.evaluationPromptId : undefined,
      evaluationPromptVersion:
        typeof parsed.evaluationPromptVersion === 'string'
          ? parsed.evaluationPromptVersion
          : undefined,
      feedbackConditionId:
        typeof parsed.feedbackConditionId === 'string' ? parsed.feedbackConditionId : undefined,
      promptId: typeof parsed.promptId === 'string' ? parsed.promptId : undefined,
      promptVersionId:
        typeof parsed.promptVersionId === 'string' ? parsed.promptVersionId : undefined,
      promptSavedAt:
        typeof parsed.promptSavedAt === 'string' || parsed.promptSavedAt === null
          ? parsed.promptSavedAt
          : undefined,
      promptSource:
        parsed.promptSource === 'custom' || parsed.promptSource === 'default'
          ? parsed.promptSource
          : undefined,
      sessionPurpose:
        parsed.sessionPurpose === 'evaluation' || parsed.sessionPurpose === 'practice'
          ? parsed.sessionPurpose
          : undefined,
      taskCardId: typeof parsed.taskCardId === 'string' ? parsed.taskCardId : undefined,
    };
  } catch {
    return {};
  }
}

function isRealtimeRoomName(name: string) {
  return (
    name.startsWith('realtime-') ||
    name.startsWith('eval-') ||
    name.startsWith('eval_') ||
    name.startsWith('task-') ||
    name.startsWith('task_')
  );
}

async function getRoomCounts(svc: RoomServiceClient, roomName: string): Promise<RoomCounts> {
  try {
    const participants = await svc.listParticipants(roomName);
    return {
      numParticipants: participants.filter((p) => p.kind === ParticipantInfo_Kind.STANDARD).length,
      totalParticipants: participants.length,
      numAgents: participants.filter((p) => p.kind === ParticipantInfo_Kind.AGENT).length,
      numEgress: participants.filter((p) => p.kind === ParticipantInfo_Kind.EGRESS).length,
    };
  } catch {
    return {
      numParticipants: 0,
      totalParticipants: 0,
      numAgents: 0,
      numEgress: 0,
    };
  }
}

export async function GET() {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
    return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
  }

  let settings: Awaited<ReturnType<typeof readSettings>>;
  try {
    settings = await readSettings();
  } catch (error) {
    const status = error instanceof SettingsStoreError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Settings store is unavailable.';
    return NextResponse.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { activeClass, numGroupsPerClass, agentMode, realtimeResetting, sessionPurpose } = settings;
  let practiceCharacter = KATE_CHARACTER;
  if (agentMode === 'realtime') {
    if (sessionPurpose === 'evaluation') {
      practiceCharacter = JACK_CHARACTER;
    } else {
      try {
        const activeVersion = await readActiveRealtimePromptVersion();
        practiceCharacter =
          activeVersion?.taskCharacter ??
          (await readRealtimeTaskCharacter(activeVersion?.taskCardId));
      } catch {
        practiceCharacter = await readRealtimeTaskCharacter();
      }
    }
  }

  const predefinedNames: string[] = Array.from(
    { length: numGroupsPerClass },
    (_, i) => `${activeClass}반-${i + 1}그룹`
  );

  const svc = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const activeRooms = await svc.listRooms();
  const activeRoomNames = new Set(activeRooms.map((r) => r.name));

  const countEntries = await Promise.all(
    activeRooms.map(async (room) => [room.name, await getRoomCounts(svc, room.name)] as const)
  );
  const countMap = new Map<string, RoomCounts>(countEntries);

  const rooms = predefinedNames.map((name) => ({
    name,
    ...(countMap.get(name) ?? {
      numParticipants: 0,
      totalParticipants: 0,
      numAgents: 0,
      numEgress: 0,
    }),
  }));

  const realtimeRooms = activeRooms
    .filter((room) => isRealtimeRoomName(room.name) && activeRoomNames.has(room.name))
    .map((room) => ({
      name: room.name,
      ...parseRealtimeRoomMetadata(room.metadata),
      ...(countMap.get(room.name) ?? {
        numParticipants: 0,
        totalParticipants: room.numParticipants,
        numAgents: 0,
        numEgress: 0,
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json(
    {
      rooms,
      activeClass,
      agentMode,
      realtimeResetting,
      sessionPurpose,
      practiceCharacter,
      realtimeRooms,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
