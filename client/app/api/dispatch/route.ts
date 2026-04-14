import { NextRequest, NextResponse } from 'next/server';
import { AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { ParticipantInfo_Kind } from '@livekit/protocol';

const API_KEY = process.env.LIVEKIT_API_KEY!;
const API_SECRET = process.env.LIVEKIT_API_SECRET!;
const LIVEKIT_URL = process.env.LIVEKIT_URL!;
const AGENT_NAME = 'my-agent';

export const revalidate = 0;

async function checkAgentPresence(roomName: string): Promise<boolean> {
  try {
    const svc = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
    const participants = await svc.listParticipants(roomName);
    return participants.some((p) => p.kind === ParticipantInfo_Kind.AGENT);
  } catch {
    // 방이 존재하지 않거나 참가자가 없는 경우
    return false;
  }
}

/** GET /api/dispatch?room=X — 방의 에이전트 존재 여부 확인 */
export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get('room');
  if (!room) {
    return NextResponse.json({ error: 'room 파라미터가 필요합니다.' }, { status: 400 });
  }

  const hasAgent = await checkAgentPresence(room);
  return NextResponse.json({ hasAgent });
}

/** POST /api/dispatch  body: { room: string } — 에이전트 수동 배치 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const room: string | undefined = body?.room;
  if (!room) {
    return NextResponse.json({ error: 'room 파라미터가 필요합니다.' }, { status: 400 });
  }

  // 에이전트 중복 방지: 배치 전 재확인
  const hasAgent = await checkAgentPresence(room);
  if (hasAgent) {
    return NextResponse.json(
      { error: '이미 에이전트가 존재하는 방입니다.' },
      { status: 409 },
    );
  }

  try {
    const client = new AgentDispatchClient(LIVEKIT_URL, API_KEY, API_SECRET);
    await client.createDispatch(room, AGENT_NAME);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
