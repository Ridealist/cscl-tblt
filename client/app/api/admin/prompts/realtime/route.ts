import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  DEFAULT_REALTIME_PROMPT_METADATA,
  type RealtimeFeedbackConditionSummary,
  type RealtimePromptConfig,
  type RealtimePromptState,
  type RealtimeTaskCardSummary,
  validateRealtimePromptConfig,
} from '@/lib/realtime-prompt-config';
import {
  RealtimePromptStoreError,
  type RealtimePromptVersion,
  activateRealtimePromptVersion,
  deactivateActiveRealtimePromptVersion,
  deleteRealtimePromptVersion,
  listRealtimePromptVersions,
  readActiveRealtimePromptVersion,
  readRealtimePromptVersion,
  saveRealtimePromptVersion,
} from '@/lib/realtime-prompt-store';
import { readSettings } from '@/lib/settings-store';
import { getAdminAuthResult, requireAdmin } from '@/lib/supabase/admin-auth';

const DEFAULT_PROMPT_SOURCE_DIR = join(process.cwd(), '..', 'prompts', 'realtime');
const PROMPT_SOURCE_MANIFEST_PATH = join(DEFAULT_PROMPT_SOURCE_DIR, 'manifest.json');
const PROMPT_FIELDS = ['basePrompt', 'dominantPrompt', 'collaborativePrompt'] as const;

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
  }
>;
type PromptDefaults = RealtimePromptConfig & {
  feedbackConditions: RealtimeFeedbackConditionSummary[];
  taskCards: RealtimeTaskCardSummary[];
};
type PromptVersionMetadata = {
  activePromptVersionId: string | null;
  activeVersion: RealtimePromptVersion | null;
  promptVersions: Awaited<ReturnType<typeof listRealtimePromptVersions>>;
};

function versionToPromptState(
  version: RealtimePromptVersion,
  defaults: PromptDefaults,
  versionMetadata: PromptVersionMetadata
): RealtimePromptState {
  return {
    basePrompt: version.basePrompt,
    dominantPrompt: version.dominantPrompt,
    collaborativePrompt: version.collaborativePrompt,
    feedbackConditionId: version.feedbackConditionId,
    feedbackPrompt: version.feedbackPrompt,
    taskCardId: version.taskCardId,
    taskCardPrompt: version.taskCardPrompt,
    promptId: version.promptId,
    savedAt: version.savedAt,
    source: version.source,
    activePromptVersionId: versionMetadata.activePromptVersionId,
    feedbackConditions: defaults.feedbackConditions,
    promptVersionCreatedAt: version.savedAt,
    promptVersionHash: version.hash,
    promptVersionId: version.promptId,
    promptVersionLabel: version.label,
    promptVersions: versionMetadata.promptVersions,
    taskCards: defaults.taskCards,
    usingDefault: false,
  };
}

async function readRuntimeFeedbackConditionId(): Promise<string | undefined> {
  try {
    return (await readSettings()).feedbackConditionId;
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
      return {
        id,
        title: typeof entry.title === 'string' && entry.title ? entry.title : id,
        topic: typeof entry.topic === 'string' && entry.topic ? entry.topic : null,
        level: typeof entry.level === 'string' && entry.level ? entry.level : null,
        prompt,
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

async function readPromptVersionMetadata(): Promise<PromptVersionMetadata> {
  const [activeVersion, promptVersions] = await Promise.all([
    readActiveRealtimePromptVersion(),
    listRealtimePromptVersions(),
  ]);
  return {
    activePromptVersionId: activeVersion?.promptId ?? null,
    activeVersion,
    promptVersions,
  };
}

function defaultPromptState(
  defaults: PromptDefaults,
  versionMetadata: PromptVersionMetadata
): RealtimePromptState {
  return {
    ...defaults,
    ...DEFAULT_REALTIME_PROMPT_METADATA,
    activePromptVersionId: versionMetadata.activePromptVersionId,
    promptVersionCreatedAt: null,
    promptVersionHash: null,
    promptVersionId: null,
    promptVersionLabel: null,
    promptVersions: versionMetadata.promptVersions,
    usingDefault: true,
  };
}

async function promptStateFromVersion(
  version: RealtimePromptVersion,
  versionMetadata?: PromptVersionMetadata
): Promise<RealtimePromptState> {
  const metadata = versionMetadata ?? (await readPromptVersionMetadata());
  const defaults = await readDefaultPromptConfigForTask(
    version.taskCardId,
    version.feedbackConditionId
  );
  return versionToPromptState(version, defaults, metadata);
}

async function readPromptConfig(
  options: {
    useDefault?: boolean;
    versionId?: string;
  } = {}
): Promise<RealtimePromptState> {
  const versionMetadata = await readPromptVersionMetadata();

  if (!options.useDefault && options.versionId) {
    const selectedVersion = await readRealtimePromptVersion(options.versionId);
    if (!selectedVersion) {
      throw new RealtimePromptStoreError(
        'prompt_version_not_found',
        'Practice 프롬프트 버전을 찾을 수 없습니다.',
        404
      );
    }
    return promptStateFromVersion(selectedVersion, versionMetadata);
  }

  const activeVersion = options.useDefault ? null : versionMetadata.activeVersion;
  if (activeVersion) {
    return promptStateFromVersion(activeVersion, versionMetadata);
  }

  return defaultPromptState(
    await readDefaultPromptConfigForTask(undefined, await readRuntimeFeedbackConditionId()),
    versionMetadata
  );
}

function getRequestPromptText(body: unknown, key: keyof RealtimePromptConfig, fallback: string) {
  if (!body || typeof body !== 'object') return fallback;
  const value = (body as Partial<Record<keyof RealtimePromptConfig, unknown>>)[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function promptStoreErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof RealtimePromptStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function versionIdFromRequest(req?: Request) {
  if (!req) return undefined;
  return new URL(req.url).searchParams.get('versionId') ?? undefined;
}

function defaultRequestedFromRequest(req?: Request) {
  if (!req) return false;
  const value = new URL(req.url).searchParams.get('default');
  return value === '1' || value === 'true';
}

export async function GET(req?: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    return NextResponse.json(
      await readPromptConfig({
        useDefault: defaultRequestedFromRequest(req),
        versionId: versionIdFromRequest(req),
      })
    );
  } catch (error) {
    return promptStoreErrorResponse(error, '기본 프롬프트 파일을 불러오지 못했습니다.');
  }
}

export async function POST(req: Request) {
  const auth = await getAdminAuthResult();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    if (body?.action === 'activate') {
      const versionId = typeof body.versionId === 'string' ? body.versionId.trim() : '';
      const version = await activateRealtimePromptVersion(versionId);
      return NextResponse.json(await promptStateFromVersion(version));
    }

    const runtimeFeedbackConditionId = await readRuntimeFeedbackConditionId();
    const requestedFeedbackConditionId =
      typeof body?.feedbackConditionId === 'string' && body.feedbackConditionId.trim()
        ? body.feedbackConditionId
        : runtimeFeedbackConditionId;
    const defaults = await readDefaultPromptConfigForTask(
      typeof body?.taskCardId === 'string' ? body.taskCardId : undefined,
      requestedFeedbackConditionId
    );
    const result = validateRealtimePromptConfig({
      ...body,
      feedbackConditionId: defaults.feedbackConditionId,
      feedbackPrompt: getRequestPromptText(body, 'feedbackPrompt', defaults.feedbackPrompt),
      taskCardId: defaults.taskCardId,
      taskCardPrompt: getRequestPromptText(body, 'taskCardPrompt', defaults.taskCardPrompt),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const version = await saveRealtimePromptVersion(result.config, {
      createdBy: auth.user.id,
      label: typeof body?.versionLabel === 'string' ? body.versionLabel : null,
    });
    return NextResponse.json(await promptStateFromVersion(version));
  } catch (error) {
    return promptStoreErrorResponse(error, '프롬프트 저장 실패');
  }
}

export async function DELETE(req?: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const versionId = versionIdFromRequest(req);
    if (versionId) {
      await deleteRealtimePromptVersion(versionId);
    } else {
      await deactivateActiveRealtimePromptVersion();
    }
    return NextResponse.json(await readPromptConfig({ useDefault: true }));
  } catch (error) {
    return promptStoreErrorResponse(error, '기본값 복원 실패');
  }
}
