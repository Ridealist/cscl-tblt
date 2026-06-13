import { NextResponse } from 'next/server';
import {
  EvaluationPromptSourceError,
  activateEvaluationPromptVersion,
  deleteEvaluationPromptOverride,
  readEvaluationPromptState,
  writeEvaluationPromptOverride,
} from '@/lib/evaluation-prompt-source';

function statusForError(error: unknown) {
  return error instanceof EvaluationPromptSourceError ? error.status : 500;
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
      { error: 'Evaluation 프롬프트 파일을 불러오지 못했습니다.' },
      { status: statusForError(error) }
    );
  }
}

export async function POST(req: Request) {
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
        error: error instanceof EvaluationPromptSourceError ? error.message : '프롬프트 저장 실패',
      },
      { status: statusForError(error) }
    );
  }
}

export async function DELETE(req: Request) {
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
        error:
          error instanceof EvaluationPromptSourceError
            ? error.message
            : '기본 Evaluation 프롬프트 복원 실패',
      },
      { status: statusForError(error) }
    );
  }
}
