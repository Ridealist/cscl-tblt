import { NextResponse } from 'next/server';
import { ConversationLogStoreError, readConversationLogData } from '@/lib/conversation-log-store';
import { requireAdmin } from '@/lib/supabase/admin-auth';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof ConversationLogStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: '대화 기록 스트림 연결 실패' }, { status: 500 });
}

export async function GET(req: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const filename = searchParams.get('filename');
  if (!sessionId && !filename) {
    return errorResponse(
      new ConversationLogStoreError(
        400,
        'session_id_required',
        'sessionId is required for conversation log streams.'
      )
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let inFlight = false;
      let lastPayload: string | null = null;

      const tick = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const data = await readConversationLogData({ filename, sessionId });
          const payload = JSON.stringify(data);
          if (payload !== lastPayload) {
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            lastPayload = payload;
          }
        } catch (error) {
          const status = error instanceof ConversationLogStoreError ? error.status : 500;
          const code = error instanceof ConversationLogStoreError ? error.code : 'stream_error';
          const message =
            error instanceof Error ? error.message : 'Conversation log stream failed.';
          const payload = JSON.stringify({ error: message, code, status });
          controller.enqueue(encoder.encode(`event: error\ndata: ${payload}\n\n`));
        } finally {
          inFlight = false;
        }
      };

      void tick(); // 연결 즉시 현재 상태 전송
      const interval = setInterval(() => void tick(), 1000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
