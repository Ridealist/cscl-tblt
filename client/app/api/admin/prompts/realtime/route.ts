import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
  DEFAULT_REALTIME_PROMPT_CONFIG,
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimePromptConfig,
  type RealtimePromptMetadata,
  type RealtimePromptState,
  validateRealtimePromptConfig,
} from '@/lib/realtime-prompt-config';

const PROMPT_CONFIG_PATH = join(process.cwd(), '..', 'prompt_config.json');

type PromptFileShape = {
  realtime?: unknown;
};

type StoredRealtimePrompt = RealtimePromptConfig & Partial<RealtimePromptMetadata>;

function createPromptMetadata(): RealtimePromptMetadata {
  const savedAt = new Date().toISOString();
  return {
    promptId: randomUUID().slice(0, 8),
    savedAt,
    source: 'custom',
  };
}

function readPromptMetadata(value: unknown): RealtimePromptMetadata {
  if (!value || typeof value !== 'object') {
    return { promptId: 'custom-unknown', savedAt: null, source: 'custom' };
  }
  const source = value as Partial<StoredRealtimePrompt>;
  return {
    promptId:
      typeof source.promptId === 'string' && source.promptId ? source.promptId : 'custom-unknown',
    savedAt: typeof source.savedAt === 'string' && source.savedAt ? source.savedAt : null,
    source: 'custom',
  };
}

async function readPromptConfig(): Promise<RealtimePromptState> {
  try {
    const raw = JSON.parse(await readFile(PROMPT_CONFIG_PATH, 'utf-8')) as PromptFileShape;
    const result = validateRealtimePromptConfig(raw.realtime);
    if (result.ok) {
      return {
        ...result.config,
        ...readPromptMetadata(raw.realtime),
        usingDefault: false,
      };
    }
  } catch {
    // Fall back to the built-in prompt defaults.
  }

  return {
    ...DEFAULT_REALTIME_PROMPT_CONFIG,
    ...DEFAULT_REALTIME_PROMPT_METADATA,
    usingDefault: true,
  };
}

async function writePromptConfig(config: RealtimePromptConfig): Promise<RealtimePromptMetadata> {
  const metadata = createPromptMetadata();
  await mkdir(dirname(PROMPT_CONFIG_PATH), { recursive: true });
  const tempPath = `${PROMPT_CONFIG_PATH}.tmp`;
  await writeFile(
    tempPath,
    `${JSON.stringify({ realtime: { ...config, ...metadata } }, null, 2)}\n`,
    'utf-8'
  );
  await rename(tempPath, PROMPT_CONFIG_PATH);
  return metadata;
}

export async function GET() {
  return NextResponse.json(await readPromptConfig());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = validateRealtimePromptConfig(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const metadata = await writePromptConfig(result.config);
    return NextResponse.json({ ...result.config, ...metadata, usingDefault: false });
  } catch {
    return NextResponse.json({ error: '프롬프트 저장 실패' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await unlink(PROMPT_CONFIG_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return NextResponse.json({ error: '기본값 복원 실패' }, { status: 500 });
    }
  }

  return NextResponse.json({
    ...DEFAULT_REALTIME_PROMPT_CONFIG,
    ...DEFAULT_REALTIME_PROMPT_METADATA,
    usingDefault: true,
  });
}
