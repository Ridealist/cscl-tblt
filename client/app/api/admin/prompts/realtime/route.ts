import { NextResponse } from 'next/server';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import {
  type PromptVersionFile,
  type PromptVersionSummary,
  activatePromptVersion,
  clearActivePromptVersion,
  createPromptVersion,
  deletePromptVersion,
  readActivePromptVersion,
  readPromptVersion,
  readPromptVersionIndex,
} from '@/lib/prompt-version-store';
import {
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimeConversationExamplePrompts,
  type RealtimeFeedbackConditionSummary,
  type RealtimeFeedbackExamples,
  type RealtimePromptConfig,
  type RealtimePromptMetadata,
  type RealtimePromptState,
  type RealtimeTaskCardSummary,
  validateRealtimePromptConfig,
} from '@/lib/realtime-prompt-config';

const PROMPT_CONFIG_PATH = join(process.cwd(), '..', 'prompt_config.json');
const RUNTIME_CONFIG_PATH = join(process.cwd(), '..', 'config.json');
const DEFAULT_PROMPT_SOURCE_DIR = join(process.cwd(), '..', 'prompts', 'realtime');
const PROMPT_SOURCE_MANIFEST_PATH = join(DEFAULT_PROMPT_SOURCE_DIR, 'manifest.json');
const PROMPT_FIELDS = ['basePrompt', 'dominantPrompt', 'collaborativePrompt'] as const;

type PromptFileShape = {
  realtime?: unknown;
};

type StoredTaskCardPrompt = {
  prompt?: unknown;
  conversationExamplePrompts?: unknown;
};
type StoredRealtimePrompt = Partial<RealtimePromptConfig> &
  Partial<RealtimePromptMetadata> & {
    passivePrompt?: unknown;
    feedbackPrompts?: unknown;
    taskCardPrompts?: unknown;
    taskCards?: unknown;
  };
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

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim()
      )
      .map(([key, text]) => [key, text.trim()])
  );
}

function readStoredFeedbackPrompts(
  source: StoredRealtimePrompt | undefined,
  fallbackFeedbackConditionId?: string
): Record<string, string> {
  const prompts = readStringMap(source?.feedbackPrompts);
  const legacyFeedbackConditionId =
    typeof source?.feedbackConditionId === 'string' && source.feedbackConditionId.trim()
      ? source.feedbackConditionId.trim()
      : fallbackFeedbackConditionId;
  if (
    legacyFeedbackConditionId &&
    prompts[legacyFeedbackConditionId] === undefined &&
    typeof source?.feedbackPrompt === 'string' &&
    source.feedbackPrompt.trim()
  ) {
    prompts[legacyFeedbackConditionId] = source.feedbackPrompt.trim();
  }
  return prompts;
}

function readStoredTaskCards(
  source: StoredRealtimePrompt | undefined,
  fallbackTaskCardId?: string
): Record<
  string,
  { prompt?: string; conversationExamplePrompts: RealtimeConversationExamplePrompts }
> {
  const stored: Record<
    string,
    { prompt?: string; conversationExamplePrompts: RealtimeConversationExamplePrompts }
  > = {};

  if (
    source?.taskCards &&
    typeof source.taskCards === 'object' &&
    !Array.isArray(source.taskCards)
  ) {
    for (const [taskCardId, value] of Object.entries(source.taskCards)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const taskCard = value as StoredTaskCardPrompt;
      const prompt =
        typeof taskCard.prompt === 'string' && taskCard.prompt.trim()
          ? taskCard.prompt.trim()
          : undefined;
      const conversationExamplePrompts = readStringMap(taskCard.conversationExamplePrompts);
      if (prompt || Object.keys(conversationExamplePrompts).length > 0) {
        stored[taskCardId] = { prompt, conversationExamplePrompts };
      }
    }
  }

  if (
    fallbackTaskCardId &&
    stored[fallbackTaskCardId] === undefined &&
    typeof source?.taskCardPrompt === 'string' &&
    source.taskCardPrompt.trim()
  ) {
    stored[fallbackTaskCardId] = {
      prompt: source.taskCardPrompt.trim(),
      conversationExamplePrompts: readStringMap(source.conversationExamplePrompts),
    };
  }

  return stored;
}

function getTaskCardExamplePrompts(
  taskCard: RealtimeTaskCardSummary | undefined
): RealtimeConversationExamplePrompts {
  const prompts: RealtimeConversationExamplePrompts = {};
  if (!taskCard?.examples) return prompts;

  for (const role of ['dominant', 'collaborative'] as const) {
    const roleExamples: RealtimeFeedbackExamples | undefined = taskCard.examples[role];
    if (!roleExamples) continue;
    for (const [feedbackConditionId, example] of Object.entries(roleExamples)) {
      const key = feedbackConditionId === 'default' ? role : `${role}.${feedbackConditionId}`;
      prompts[key] = example.prompt;
    }
  }

  return prompts;
}

function applyTaskCardOverrides(
  taskCards: RealtimeTaskCardSummary[],
  storedTaskCards: Record<
    string,
    { prompt?: string; conversationExamplePrompts: RealtimeConversationExamplePrompts }
  >
): RealtimeTaskCardSummary[] {
  return taskCards.map((taskCard) => {
    const stored = storedTaskCards[taskCard.id];
    if (!stored) return taskCard;

    const examples: NonNullable<RealtimeTaskCardSummary['examples']> = {};
    if (taskCard.examples?.dominant) {
      examples.dominant = { ...taskCard.examples.dominant };
    }
    if (taskCard.examples?.collaborative) {
      examples.collaborative = { ...taskCard.examples.collaborative };
    }

    for (const [key, prompt] of Object.entries(stored.conversationExamplePrompts)) {
      const [role, feedbackConditionId = 'default'] = key.split('.');
      if (role !== 'dominant' && role !== 'collaborative') continue;
      examples[role] = examples[role] ? { ...examples[role] } : {};
      const existing = examples[role]?.[feedbackConditionId];
      examples[role][feedbackConditionId] = {
        file: existing?.file ?? 'custom',
        marker: existing?.marker ?? '',
        prompt,
      };
    }

    return {
      ...taskCard,
      prompt: stored.prompt ?? taskCard.prompt,
      ...(Object.keys(examples).length ? { examples } : {}),
    };
  });
}

function applyFeedbackPromptOverrides(
  feedbackConditions: RealtimeFeedbackConditionSummary[],
  feedbackPrompts: Record<string, string>
): RealtimeFeedbackConditionSummary[] {
  return feedbackConditions.map((condition) => ({
    ...condition,
    prompt: feedbackPrompts[condition.id] ?? condition.prompt,
  }));
}

async function readRealtimeVersionMetadata(): Promise<{
  activePromptVersionId: string | null;
  promptVersions: PromptVersionSummary[];
}> {
  const index = await readPromptVersionIndex();
  return {
    activePromptVersionId: index.active.realtime ?? null,
    promptVersions: index.versions.realtime,
  };
}

async function stateFromRealtimeVersion(
  version: PromptVersionFile<RealtimePromptConfig>
): Promise<RealtimePromptState> {
  const result = validateRealtimePromptConfig(version.config);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const config = result.config;
  const defaults = await readDefaultPromptConfigForTask(
    config.taskCardId,
    config.feedbackConditionId
  );
  const feedbackConditions = applyFeedbackPromptOverrides(defaults.feedbackConditions, {
    [config.feedbackConditionId]: config.feedbackPrompt,
  });
  const taskCards = applyTaskCardOverrides(defaults.taskCards, {
    [config.taskCardId]: {
      prompt: config.taskCardPrompt,
      conversationExamplePrompts: config.conversationExamplePrompts,
    },
  });
  const versionMetadata = await readRealtimeVersionMetadata();

  return {
    ...config,
    feedbackConditions,
    taskCards,
    promptId: version.id,
    savedAt: version.createdAt,
    source: 'custom',
    activePromptVersionId: versionMetadata.activePromptVersionId,
    promptVersionCreatedAt: version.createdAt,
    promptVersionHash: version.hash,
    promptVersionId: version.id,
    promptVersionLabel: version.label,
    promptVersions: versionMetadata.promptVersions,
    usingDefault: false,
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

async function readRuntimeFeedbackConditionId(): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await readFile(RUNTIME_CONFIG_PATH, 'utf-8')) as {
      feedbackConditionId?: unknown;
    };
    return typeof raw.feedbackConditionId === 'string' && raw.feedbackConditionId.trim()
      ? raw.feedbackConditionId.trim()
      : undefined;
  } catch {
    return undefined;
  }
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
    conversationExamplePrompts: taskCard.conversationExamplePrompts,
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
  const requestedFeedbackConditionId =
    feedbackConditionId || defaultFeedbackConditionId || feedbackConditions[0]?.id;
  const selectedFeedbackConditionId =
    requestedFeedbackConditionId && feedbackManifest[requestedFeedbackConditionId]
      ? requestedFeedbackConditionId
      : defaultFeedbackConditionId && feedbackManifest[defaultFeedbackConditionId]
        ? defaultFeedbackConditionId
        : feedbackConditions[0]?.id;
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
  conversationExamplePrompts: RealtimeConversationExamplePrompts;
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
      conversationExamplePrompts: {},
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
  const conversationExamplePrompts = getTaskCardExamplePrompts(
    taskCards.find((taskCard) => taskCard.id === selectedTaskCardId)
  );
  return {
    taskCardId: selectedTaskCardId,
    taskCardPrompt,
    conversationExamplePrompts,
    taskCards,
  };
}

async function readDefaultPromptState(
  versionMetadata?: Awaited<ReturnType<typeof readRealtimeVersionMetadata>>
): Promise<RealtimePromptState> {
  const metadata = versionMetadata ?? (await readRealtimeVersionMetadata());
  return {
    ...(await readDefaultPromptConfigForTask(undefined, await readRuntimeFeedbackConditionId())),
    ...DEFAULT_REALTIME_PROMPT_METADATA,
    activePromptVersionId: metadata.activePromptVersionId,
    promptVersionCreatedAt: null,
    promptVersionHash: null,
    promptVersionId: null,
    promptVersionLabel: null,
    promptVersions: metadata.promptVersions,
    usingDefault: true,
  };
}

async function readPromptConfig(options?: {
  useDefault?: boolean;
  versionId?: string;
}): Promise<RealtimePromptState> {
  const requestedVersion = options?.useDefault
    ? null
    : options?.versionId
      ? await readPromptVersion<RealtimePromptConfig>('realtime', options.versionId)
      : await readActivePromptVersion<RealtimePromptConfig>('realtime');
  if (requestedVersion) {
    return stateFromRealtimeVersion(requestedVersion);
  }

  const versionMetadata = await readRealtimeVersionMetadata();
  if (options?.useDefault) {
    return readDefaultPromptState(versionMetadata);
  }

  let source: StoredRealtimePrompt | null = null;
  try {
    const raw = JSON.parse(await readFile(PROMPT_CONFIG_PATH, 'utf-8')) as PromptFileShape;
    source =
      raw.realtime && typeof raw.realtime === 'object' && !Array.isArray(raw.realtime)
        ? (raw.realtime as StoredRealtimePrompt)
        : null;
  } catch {
    // Fall back to the tracked prompt defaults.
  }

  if (!source) {
    return readDefaultPromptState(versionMetadata);
  }

  try {
    const runtimeFeedbackConditionId = await readRuntimeFeedbackConditionId();
    const sourceTaskCardId =
      typeof source?.taskCardId === 'string' && source.taskCardId.trim()
        ? source.taskCardId.trim()
        : undefined;
    const defaults = await readDefaultPromptConfigForTask(
      sourceTaskCardId,
      runtimeFeedbackConditionId
    );
    const storedFeedbackPrompts = readStoredFeedbackPrompts(source, defaults.feedbackConditionId);
    const storedTaskCards = readStoredTaskCards(source, defaults.taskCardId);
    const feedbackConditions = applyFeedbackPromptOverrides(
      defaults.feedbackConditions,
      storedFeedbackPrompts
    );
    const taskCards = applyTaskCardOverrides(defaults.taskCards, storedTaskCards);
    const selectedTaskCard = taskCards.find((taskCard) => taskCard.id === defaults.taskCardId);
    const result = validateRealtimePromptConfig({
      basePrompt: source?.basePrompt ?? defaults.basePrompt,
      dominantPrompt: source?.dominantPrompt ?? defaults.dominantPrompt,
      collaborativePrompt:
        source?.collaborativePrompt ?? source?.passivePrompt ?? defaults.collaborativePrompt,
      feedbackConditionId: defaults.feedbackConditionId,
      feedbackPrompt:
        storedFeedbackPrompts[defaults.feedbackConditionId] ?? defaults.feedbackPrompt,
      taskCardId: defaults.taskCardId,
      taskCardPrompt: selectedTaskCard?.prompt ?? defaults.taskCardPrompt,
      conversationExamplePrompts: selectedTaskCard
        ? getTaskCardExamplePrompts(selectedTaskCard)
        : defaults.conversationExamplePrompts,
    });
    if (result.ok) {
      return {
        ...result.config,
        feedbackConditions,
        taskCards,
        ...readPromptMetadata(source),
        activePromptVersionId: versionMetadata.activePromptVersionId,
        promptVersionCreatedAt: null,
        promptVersionHash: null,
        promptVersionId: null,
        promptVersionLabel: null,
        promptVersions: versionMetadata.promptVersions,
        usingDefault: false,
      };
    }
  } catch {
    // Fall back to the tracked prompt defaults.
  }

  return readDefaultPromptState(versionMetadata);
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
      await readPromptConfig({
        useDefault: defaultRequestedFromRequest(req),
        versionId: versionIdFromRequest(req),
      })
    );
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
    if (body?.action === 'activate') {
      const versionId = typeof body.versionId === 'string' ? body.versionId : '';
      const version = await activatePromptVersion('realtime', versionId);
      if (!version) {
        return NextResponse.json({ error: '프롬프트 버전을 찾을 수 없습니다.' }, { status: 404 });
      }
      return NextResponse.json(await readPromptConfig({ versionId }));
    }

    const runtimeFeedbackConditionId = await readRuntimeFeedbackConditionId();
    const requestedFeedbackConditionId =
      typeof body?.feedbackConditionId === 'string' && body.feedbackConditionId.trim()
        ? body.feedbackConditionId.trim()
        : runtimeFeedbackConditionId;
    const defaults = await readDefaultPromptConfigForTask(
      typeof body?.taskCardId === 'string' ? body.taskCardId : undefined,
      requestedFeedbackConditionId
    );
    const result = validateRealtimePromptConfig({
      ...body,
      feedbackConditionId: defaults.feedbackConditionId,
      taskCardId: defaults.taskCardId,
      feedbackPrompt:
        typeof body?.feedbackPrompt === 'string' && body.feedbackPrompt.trim()
          ? body.feedbackPrompt
          : defaults.feedbackPrompt,
      taskCardPrompt:
        typeof body?.taskCardPrompt === 'string' && body.taskCardPrompt.trim()
          ? body.taskCardPrompt
          : defaults.taskCardPrompt,
      conversationExamplePrompts:
        body?.conversationExamplePrompts &&
        typeof body.conversationExamplePrompts === 'object' &&
        !Array.isArray(body.conversationExamplePrompts)
          ? body.conversationExamplePrompts
          : defaults.conversationExamplePrompts,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const version = await createPromptVersion({
      purpose: 'realtime',
      label: typeof body?.versionLabel === 'string' ? body.versionLabel : undefined,
      config: result.config,
      activate: true,
    });
    return NextResponse.json(await readPromptConfig({ versionId: version.id }));
  } catch {
    return NextResponse.json({ error: '프롬프트 저장 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const versionId = versionIdFromRequest(req);
  if (versionId) {
    try {
      await deletePromptVersion('realtime', versionId);
      return NextResponse.json(await readPromptConfig());
    } catch {
      return NextResponse.json({ error: '프롬프트 버전 삭제 실패' }, { status: 500 });
    }
  }

  try {
    await clearActivePromptVersion('realtime');
    await unlink(PROMPT_CONFIG_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return NextResponse.json({ error: '기본값 복원 실패' }, { status: 500 });
    }
  }

  try {
    return NextResponse.json(await readPromptConfig());
  } catch {
    return NextResponse.json(
      { error: '기본 프롬프트 파일을 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}
