import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { RoomServiceClient } from 'livekit-server-sdk';
import { join } from 'path';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { type AgentMode, normalizeAgentMode } from '@/lib/agent-mode';
import { type AgentRole, normalizeAgentRole } from '@/lib/agent-role';
import type { RealtimePromptSource } from '@/lib/realtime-prompt-config';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

const CONFIG_PATH = join(process.cwd(), '..', 'config.json');

function readConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      numClasses: typeof raw.numClasses === 'number' ? raw.numClasses : 4,
      numGroupsPerClass: typeof raw.numGroupsPerClass === 'number' ? raw.numGroupsPerClass : 4,
      classStart: typeof raw.classStart === 'number' ? raw.classStart : 1,
      activeClass: typeof raw.activeClass === 'number' ? raw.activeClass : 1,
      agentMode: normalizeAgentMode(raw.agentMode),
      realtimeResetting: raw.realtimeResetting === true,
    };
  } catch {
    return {
      numClasses: 4,
      numGroupsPerClass: 4,
      classStart: 1,
      activeClass: 1,
      agentMode: 'pipeline' as AgentMode,
      realtimeResetting: false,
    };
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RoomCounts = {
  numParticipants: number;
  totalParticipants: number;
  numAgents: number;
  numEgress: number;
};

function parseRealtimeRoomMetadata(metadata?: string): {
  agentRole?: AgentRole;
  promptId?: string;
  promptSavedAt?: string | null;
  promptSource?: RealtimePromptSource;
} {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as {
      agentMode?: unknown;
      agentRole?: unknown;
      agentStance?: unknown;
      promptId?: unknown;
      promptSavedAt?: unknown;
      promptSource?: unknown;
    };
    const rawRole = parsed.agentRole ?? parsed.agentStance;
    if (parsed.agentMode !== 'realtime' || !rawRole) return {};
    return {
      agentRole: normalizeAgentRole(rawRole),
      promptId: typeof parsed.promptId === 'string' ? parsed.promptId : undefined,
      promptSavedAt:
        typeof parsed.promptSavedAt === 'string' || parsed.promptSavedAt === null
          ? parsed.promptSavedAt
          : undefined,
      promptSource:
        parsed.promptSource === 'custom' || parsed.promptSource === 'default'
          ? parsed.promptSource
          : undefined,
    };
  } catch {
    return {};
  }
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

  const { activeClass, numGroupsPerClass, agentMode, realtimeResetting } = readConfig();

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
    .filter((room) => room.name.startsWith('realtime-') && activeRoomNames.has(room.name))
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
    { rooms, activeClass, agentMode, realtimeResetting, realtimeRooms },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
