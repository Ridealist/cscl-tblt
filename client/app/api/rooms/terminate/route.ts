import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';

const API_KEY = process.env.LIVEKIT_API_KEY!;
const API_SECRET = process.env.LIVEKIT_API_SECRET!;
const LIVEKIT_URL = process.env.LIVEKIT_URL!;

/** POST /api/rooms/terminate  body: { room: string } — 룸 삭제 (모든 참가자 퇴장) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const room: string | undefined = body?.room;
  if (!room) {
    return NextResponse.json({ error: 'room 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    const svc = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
    await svc.deleteRoom(room);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
