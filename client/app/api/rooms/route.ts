import { NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

export const revalidate = 0;

export async function GET() {
  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
    return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
  }

  const svc = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  const rooms = await svc.listRooms();

  const result = rooms.map((r) => ({
    name: r.name,
    numParticipants: r.numParticipants,
    creationTime: Number(r.creationTime),
  }));

  return NextResponse.json({ rooms: result });
}
