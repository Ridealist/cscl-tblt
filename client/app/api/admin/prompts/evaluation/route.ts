import { NextResponse } from 'next/server';
import {
  EvaluationPromptSourceError,
  activateEvaluationPromptVersion,
  deleteEvaluationPromptOverride,
  readEvaluationPromptState,
  writeEvaluationPromptOverride,
} from '@/lib/evaluation-prompt-source';
import { PromptVersionStoreError } from '@/lib/prompt-version-db-store';
import { requireAdmin } from '@/lib/supabase/admin-auth';

function statusForError(error: unknown) {
  if (error instanceof EvaluationPromptSourceError) return error.status;
  if (error instanceof PromptVersionStoreError) return error.status;
  return 500;
}

function messageForError(error: unknown, fallback: string) {
  if (error instanceof EvaluationPromptSourceError || error instanceof PromptVersionStoreError) {
    return error.message;
  }
  return fallback;
}

function evaluationIdFromRequest(req: Request) {
  return new URL(req.url).searchParams.get('evaluationId') ?? undefined;
}

function versionIdFromRequest(req: Request) {
  return new URL(req.url).searchParams.get('versionId') ?? undefined;
}

function defaultRequestedFromRequest(req: Request) {
  const value = new URL(req.url).searchParams.get('default');
  return value === '1' || value === 'true';
}

export async function GET(req: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    return NextResponse.json(
      await readEvaluationPromptState({
        evaluationId: evaluationIdFromRequest(req),
        useDefault: defaultRequestedFromRequest(req),
        versionId: versionIdFromRequest(req),
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: messageForError(error, 'Evaluation 프롬프트 파일을 불러오지 못했습니다.') },
      { status: statusForError(error) }
    );
  }
}

export async function POST(req: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const body = await req.json();
    if (body?.action === 'activate') {
      const versionId = typeof body.versionId === 'string' ? body.versionId : '';
      return NextResponse.json(await activateEvaluationPromptVersion(versionId));
    }

    return NextResponse.json(
      await writeEvaluationPromptOverride({
        evaluationId:
          typeof body?.evaluationId === 'string' && body.evaluationId.trim()
            ? body.evaluationId.trim()
            : evaluationIdFromRequest(req),
        label: typeof body?.versionLabel === 'string' ? body.versionLabel : undefined,
        prompt: body?.prompt,
      })
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: messageForError(error, '프롬프트 저장 실패'),
      },
      { status: statusForError(error) }
    );
  }
}

export async function DELETE(req: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    return NextResponse.json(
      await deleteEvaluationPromptOverride({
        evaluationId: evaluationIdFromRequest(req),
        versionId: versionIdFromRequest(req),
      })
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: messageForError(error, '기본 Evaluation 프롬프트 복원 실패'),
      },
      { status: statusForError(error) }
    );
  }
}
