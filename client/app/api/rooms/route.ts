import { NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

const CONFIG_PATH = join(process.cwd(), '..', 'config.json');

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { numClasses: 4, numGroupsPerClass: 4, classStart: 1, activeClass: 1 };
  }
}

export const revalidate = 0;

export async function GET() {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
    return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
  }

  const { activeClass, numGroupsPerClass } = readConfig();

  const predefinedNames: string[] = Array.from(
    { length: numGroupsPerClass },
    (_, i) => `${activeClass}반-${i + 1}그룹`
  );

  const svc = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const activeRooms = await svc.listRooms();
  const activeMap = new Map(activeRooms.map((r) => [r.name, r.numParticipants]));

  const rooms = predefinedNames.map((name) => ({
    name,
    numParticipants: activeMap.get(name) ?? 0,
  }));

  return NextResponse.json({ rooms, activeClass });
}
