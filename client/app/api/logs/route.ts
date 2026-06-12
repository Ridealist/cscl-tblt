import { NextResponse } from 'next/server';
import {
  ConversationLogStoreError,
  parseConversationLogSessionFilters,
  readConversationLogSessions,
} from '@/lib/conversation-log-store';
import { requireAdmin } from '@/lib/supabase/admin-auth';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function errorResponse(error: unknown) {
  if (error instanceof ConversationLogStoreError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: NO_STORE_HEADERS }
    );
  }
  return NextResponse.json(
    { error: '대화 기록 불러오기 실패' },
    { status: 500, headers: NO_STORE_HEADERS }
  );
}

export async function GET(req: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { searchParams } = new URL(req.url);
    const sessions = await readConversationLogSessions(
      parseConversationLogSessionFilters(searchParams)
    );

    return NextResponse.json({ sessions }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
