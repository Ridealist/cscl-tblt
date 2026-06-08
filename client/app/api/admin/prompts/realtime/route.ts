import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimeFeedbackConditionSummary,
  type RealtimePromptConfig,
  type RealtimePromptMetadata,
  type RealtimePromptState,
  type RealtimeTaskCardSummary,
  validateRealtimePromptConfig,
} from '@/lib/realtime-prompt-config';

const PROMPT_CONFIG_PATH = join(process.cwd(), '..', 'prompt_config.json');
const DEFAULT_PROMPT_SOURCE_DIR = join(process.cwd(), '..', 'prompts', 'realtime');
const PROMPT_SOURCE_MANIFEST_PATH = join(DEFAULT_PROMPT_SOURCE_DIR, 'manifest.json');
const PROMPT_FIELDS = ['basePrompt', 'dominantPrompt', 'collaborativePrompt'] as const;

type PromptFileShape = {
  realtime?: unknown;
};

type StoredRealtimePrompt = Partial<RealtimePromptConfig> & Partial<RealtimePromptMetadata>;
type PromptManifest = Record<(typeof PROMPT_FIELDS)[number], { file: string; marker: string }> & {
  feedbackConditionManifest?: string;
  defaultFeedbackConditionId?: string;
  taskCardManifest?: string;
  defaultTaskCardId?: string;
  taskCardPrompt?: { file: string; marker: string };
};
type FeedbackConditionManifest = Record<
  string,
  {
    file: string;
    title?: string;
    marker: string;
  }
>;
type TaskCardManifest = Record<
  string,
  {
    file: string;
    title?: string;
    topic?: string;
    level?: string;
    marker: string;
    examples?: Partial<
      Record<'dominant' | 'collaborative', Record<string, { file: string; marker: string }>>
    >;
  }
>;
type PromptDefaults = RealtimePromptConfig & {
  feedbackConditions: RealtimeFeedbackConditionSummary[];
  taskCards: RealtimeTaskCardSummary[];
};

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

async function readDefaultPromptConfigForTask(
  taskCardId?: string,
  feedbackConditionId?: string
): Promise<PromptDefaults> {
  const manifest = JSON.parse(
    await readFile(PROMPT_SOURCE_MANIFEST_PATH, 'utf-8')
  ) as Partial<PromptManifest>;
  const config = Object.fromEntries(
    await Promise.all(
      PROMPT_FIELDS.map(async (key) => {
        const entry = manifest[key];
        if (!entry || typeof entry.file !== 'string' || typeof entry.marker !== 'string') {
          throw new Error(`기본 프롬프트 manifest의 ${key} 항목이 올바르지 않습니다.`);
        }
        const text = (await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, entry.file), 'utf-8')).trim();
        if (!text.startsWith(entry.marker)) {
          throw new Error(`${entry.file} 파일은 ${entry.marker} 헤딩으로 시작해야 합니다.`);
        }
        return [key, text];
      })
    )
  );
  const feedbackCondition = await readFeedbackConditionConfig(manifest, feedbackConditionId);
  const taskCard = await readTaskCardConfig(manifest, taskCardId);
  const result = validateRealtimePromptConfig({
    ...config,
    feedbackConditionId: feedbackCondition.feedbackConditionId,
    feedbackPrompt: feedbackCondition.feedbackPrompt,
    taskCardId: taskCard.taskCardId,
    taskCardPrompt: taskCard.taskCardPrompt,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return {
    ...result.config,
    feedbackConditions: feedbackCondition.feedbackConditions,
    taskCards: taskCard.taskCards,
  };
}

async function readFeedbackConditionConfig(
  manifest: Partial<PromptManifest>,
  feedbackConditionId?: string
): Promise<{
  feedbackConditionId: string;
  feedbackPrompt: string;
  feedbackConditions: RealtimeFeedbackConditionSummary[];
}> {
  const manifestFile =
    typeof manifest.feedbackConditionManifest === 'string' && manifest.feedbackConditionManifest
      ? manifest.feedbackConditionManifest
      : 'feedbacks/manifest.json';
  const defaultFeedbackConditionId =
    typeof manifest.defaultFeedbackConditionId === 'string' && manifest.defaultFeedbackConditionId
      ? manifest.defaultFeedbackConditionId
      : null;
  const feedbackManifest = JSON.parse(
    await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, manifestFile), 'utf-8')
  ) as FeedbackConditionManifest;
  const feedbackConditions = await Promise.all(
    Object.entries(feedbackManifest).map(async ([id, entry]) => {
      const prompt = (
        await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, 'feedbacks', entry.file), 'utf-8')
      ).trim();
      if (!prompt.startsWith(entry.marker)) {
        throw new Error(`${entry.file} 파일은 ${entry.marker} 헤딩으로 시작해야 합니다.`);
      }
      return {
        id,
        title: typeof entry.title === 'string' && entry.title ? entry.title : id,
        prompt,
      };
    })
  );
  const selectedFeedbackConditionId =
    feedbackConditionId || defaultFeedbackConditionId || feedbackConditions[0]?.id;
  const selected = selectedFeedbackConditionId
    ? feedbackManifest[selectedFeedbackConditionId]
    : null;
  if (!selected || typeof selected.file !== 'string' || typeof selected.marker !== 'string') {
    throw new Error(
      `Feedback condition을 찾을 수 없습니다: ${selectedFeedbackConditionId ?? '(empty)'}`
    );
  }
  const feedbackPrompt =
    feedbackConditions.find((feedback) => feedback.id === selectedFeedbackConditionId)?.prompt ??
    '';
  return {
    feedbackConditionId: selectedFeedbackConditionId,
    feedbackPrompt,
    feedbackConditions,
  };
}

async function readTaskCardConfig(
  manifest: Partial<PromptManifest>,
  taskCardId?: string
): Promise<{
  taskCardId: string;
  taskCardPrompt: string;
  taskCards: RealtimeTaskCardSummary[];
}> {
  if (manifest.taskCardPrompt?.file && manifest.taskCardPrompt.marker && !taskCardId) {
    const taskCardPrompt = (
      await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, manifest.taskCardPrompt.file), 'utf-8')
    ).trim();
    if (!taskCardPrompt.startsWith(manifest.taskCardPrompt.marker)) {
      throw new Error(
        `${manifest.taskCardPrompt.file} 파일은 ${manifest.taskCardPrompt.marker} 헤딩으로 시작해야 합니다.`
      );
    }
    return {
      taskCardId: 'legacy_task_card',
      taskCardPrompt,
      taskCards: [
        {
          id: 'legacy_task_card',
          title: 'Legacy Task Card',
          topic: null,
          level: null,
          prompt: taskCardPrompt,
        },
      ],
    };
  }

  const manifestFile =
    typeof manifest.taskCardManifest === 'string' && manifest.taskCardManifest
      ? manifest.taskCardManifest
      : 'task-cards/manifest.json';
  const defaultTaskCardId =
    typeof manifest.defaultTaskCardId === 'string' && manifest.defaultTaskCardId
      ? manifest.defaultTaskCardId
      : null;
  const taskCardsManifest = JSON.parse(
    await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, manifestFile), 'utf-8')
  ) as TaskCardManifest;
  const taskCards = await Promise.all(
    Object.entries(taskCardsManifest).map(async ([id, entry]) => {
      const prompt = (
        await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, 'task-cards', entry.file), 'utf-8')
      ).trim();
      if (!prompt.startsWith(entry.marker)) {
        throw new Error(`${entry.file} 파일은 ${entry.marker} 헤딩으로 시작해야 합니다.`);
      }
      const examples: NonNullable<RealtimeTaskCardSummary['examples']> = {};
      if (entry.examples) {
        for (const role of ['dominant', 'collaborative'] as const) {
          const roleExamples = entry.examples[role];
          if (!roleExamples) continue;
          examples[role] = {};

          if ('file' in roleExamples || 'marker' in roleExamples) {
            const legacyExample = roleExamples as unknown as { file?: string; marker?: string };
            if (
              typeof legacyExample.file !== 'string' ||
              typeof legacyExample.marker !== 'string'
            ) {
              throw new Error(`${id} ${role} example 설정이 올바르지 않습니다.`);
            }
            const examplePrompt = (
              await readFile(
                join(DEFAULT_PROMPT_SOURCE_DIR, 'task-cards', legacyExample.file),
                'utf-8'
              )
            ).trim();
            if (!examplePrompt.startsWith(legacyExample.marker)) {
              throw new Error(
                `${legacyExample.file} 파일은 ${legacyExample.marker} 헤딩으로 시작해야 합니다.`
              );
            }
            examples[role].default = {
              file: legacyExample.file,
              marker: legacyExample.marker,
              prompt: examplePrompt,
            };
            continue;
          }

          for (const [feedbackConditionId, example] of Object.entries(roleExamples)) {
            const examplePrompt = (
              await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, 'task-cards', example.file), 'utf-8')
            ).trim();
            if (!examplePrompt.startsWith(example.marker)) {
              throw new Error(`${example.file} 파일은 ${example.marker} 헤딩으로 시작해야 합니다.`);
            }
            examples[role][feedbackConditionId] = {
              file: example.file,
              marker: example.marker,
              prompt: examplePrompt,
            };
          }

          if (Object.keys(examples[role]).length === 0) {
            delete examples[role];
          }
        }
      }
      return {
        id,
        title: typeof entry.title === 'string' && entry.title ? entry.title : id,
        topic: typeof entry.topic === 'string' && entry.topic ? entry.topic : null,
        level: typeof entry.level === 'string' && entry.level ? entry.level : null,
        prompt,
        ...(Object.keys(examples).length ? { examples } : {}),
      };
    })
  );
  const selectedTaskCardId = taskCardId || defaultTaskCardId || taskCards[0]?.id;
  const selected = selectedTaskCardId ? taskCardsManifest[selectedTaskCardId] : null;
  if (!selected || typeof selected.file !== 'string' || typeof selected.marker !== 'string') {
    throw new Error(`Task card를 찾을 수 없습니다: ${selectedTaskCardId ?? '(empty)'}`);
  }
  const taskCardPrompt =
    taskCards.find((taskCard) => taskCard.id === selectedTaskCardId)?.prompt ?? '';
  return {
    taskCardId: selectedTaskCardId,
    taskCardPrompt,
    taskCards,
  };
}

async function readPromptConfig(): Promise<RealtimePromptState> {
  try {
    const raw = JSON.parse(await readFile(PROMPT_CONFIG_PATH, 'utf-8')) as PromptFileShape;
    const source = raw.realtime as StoredRealtimePrompt | undefined;
    const defaults = await readDefaultPromptConfigForTask(
      typeof source?.taskCardId === 'string' ? source.taskCardId : undefined,
      typeof source?.feedbackConditionId === 'string' ? source.feedbackConditionId : undefined
    );
    const result = validateRealtimePromptConfig({
      ...source,
      feedbackConditionId: defaults.feedbackConditionId,
      feedbackPrompt:
        typeof source?.feedbackPrompt === 'string' && source.feedbackPrompt.trim()
          ? source.feedbackPrompt
          : defaults.feedbackPrompt,
      taskCardId: defaults.taskCardId,
      taskCardPrompt:
        typeof source?.taskCardPrompt === 'string' && source.taskCardPrompt.trim()
          ? source.taskCardPrompt
          : defaults.taskCardPrompt,
    });
    if (result.ok) {
      return {
        ...result.config,
        feedbackConditions: defaults.feedbackConditions,
        taskCards: defaults.taskCards,
        ...readPromptMetadata(raw.realtime),
        usingDefault: false,
      };
    }
  } catch {
    // Fall back to the tracked prompt defaults.
  }

  return {
    ...(await readDefaultPromptConfigForTask()),
    ...DEFAULT_REALTIME_PROMPT_METADATA,
    usingDefault: true,
  };
}

async function writePromptConfig(config: RealtimePromptConfig): Promise<RealtimePromptMetadata> {
  const metadata = createPromptMetadata();
  const stored = {
    basePrompt: config.basePrompt,
    dominantPrompt: config.dominantPrompt,
    collaborativePrompt: config.collaborativePrompt,
    feedbackConditionId: config.feedbackConditionId,
    taskCardId: config.taskCardId,
    ...metadata,
  };
  await mkdir(dirname(PROMPT_CONFIG_PATH), { recursive: true });
  const tempPath = `${PROMPT_CONFIG_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ realtime: stored }, null, 2)}\n`, 'utf-8');
  await rename(tempPath, PROMPT_CONFIG_PATH);
  return metadata;
}

export async function GET() {
  try {
    return NextResponse.json(await readPromptConfig());
  } catch {
    return NextResponse.json(
      { error: '기본 프롬프트 파일을 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const defaults = await readDefaultPromptConfigForTask(
      typeof body?.taskCardId === 'string' ? body.taskCardId : undefined,
      typeof body?.feedbackConditionId === 'string' ? body.feedbackConditionId : undefined
    );
    const result = validateRealtimePromptConfig({
      ...body,
      feedbackConditionId: defaults.feedbackConditionId,
      feedbackPrompt: defaults.feedbackPrompt,
      taskCardId: defaults.taskCardId,
      taskCardPrompt: defaults.taskCardPrompt,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const metadata = await writePromptConfig(result.config);
    return NextResponse.json({
      ...result.config,
      taskCards: defaults.taskCards,
      ...metadata,
      usingDefault: false,
    });
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

  try {
    return NextResponse.json({
      ...(await readDefaultPromptConfigForTask()),
      ...DEFAULT_REALTIME_PROMPT_METADATA,
      usingDefault: true,
    });
  } catch {
    return NextResponse.json(
      { error: '기본 프롬프트 파일을 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}
