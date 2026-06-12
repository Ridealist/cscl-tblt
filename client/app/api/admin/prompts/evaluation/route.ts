import { NextResponse } from 'next/server';
import {
  EvaluationPromptSourceError,
  readEvaluationPromptState,
} from '@/lib/evaluation-prompt-source';

export async function GET() {
  try {
    return NextResponse.json(await readEvaluationPromptState());
  } catch (error) {
    const status = error instanceof EvaluationPromptSourceError ? error.status : 500;
    return NextResponse.json(
      { error: 'Evaluation 프롬프트 파일을 불러오지 못했습니다.' },
      { status }
    );
  }
}
