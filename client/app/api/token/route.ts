import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { join } from 'path';
import { RoomConfiguration } from '@livekit/protocol';
import { type AgentMode, normalizeAgentMode } from '@/lib/agent-mode';
import {
  type AgentStance,
  DEFAULT_AGENT_STANCE,
  getAgentNameForConfig,
  normalizeAgentStance,
} from '@/lib/agent-stance';

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

type RuntimeConfig = {
  agentMode: AgentMode;
  agentStance: AgentStance;
};

// don't cache the results
export const revalidate = 0;

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

    // Use provided name/room or fall back to random values
    const participantName = body?.participant_name?.trim() || 'user';
    const participantIdentity = `${participantName}_${Math.floor(Math.random() * 10_000)}`;
    const roomName = body?.room_name?.trim() || `room_${Math.floor(Math.random() * 10_000)}`;
    const config = readRuntimeConfig();
    const agentMode = inferAgentMode(body?.agent_mode, roomName, config.agentMode);
    const agentName = getAgentNameForConfig(agentMode, config.agentStance);
    const roomConfig = buildRoomConfig(agentName, agentMode, config.agentStance);

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
    const headers = new Headers({
      'Cache-Control': 'no-store',
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function readRuntimeConfig(): RuntimeConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      agentMode: normalizeAgentMode(raw.agentMode),
      agentStance: normalizeAgentStance(raw.agentStance),
    };
  } catch {
    return {
      agentMode: 'pipeline',
      agentStance: DEFAULT_AGENT_STANCE,
    };
  }
}

function inferAgentMode(value: unknown, roomName: string, fallback: AgentMode): AgentMode {
  if (roomName.startsWith('realtime-')) return 'realtime';
  return normalizeAgentMode(value ?? fallback);
}

function buildRoomConfig(
  agentName: string,
  agentMode: AgentMode,
  agentStance: AgentStance
): RoomConfiguration {
  const metadata = JSON.stringify({
    agentMode,
    ...(agentMode === 'realtime' ? { agentStance } : {}),
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
