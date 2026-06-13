import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
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

const DEFAULT_PROMPT_SOURCE_DIR = join(process.cwd(), '..', 'prompts', 'evaluation');
const PROMPT_SOURCE_MANIFEST_PATH = join(DEFAULT_PROMPT_SOURCE_DIR, 'manifest.json');
const PROMPT_CONFIG_PATH = join(process.cwd(), '..', 'prompt_config.json');

type EvaluationManifest = {
  defaultEvaluationId?: unknown;
  evaluations?: unknown;
};

type EvaluationManifestEntry = {
  character?: unknown;
  file?: unknown;
  marker?: unknown;
  promptId?: unknown;
  version?: unknown;
};

type EvaluationSummary = {
  character: string;
  file: string;
  id: string;
  marker: string;
  openingSentence: string;
  prompt: string;
  promptId: string;
  version?: string;
};

type StoredEvaluationPrompt = {
  prompt?: unknown;
  promptId?: unknown;
  savedAt?: unknown;
};

type PromptConfigFile = {
  evaluation?: {
    evaluationPrompts?: unknown;
  };
  realtime?: unknown;
};

type EvaluationVersionConfig = {
  evaluationId: string;
  prompt: string;
};

export type EvaluationPromptState = {
  activePromptVersionId: string | null;
  evaluationCharacter: string;
  evaluationId: string;
  evaluationPromptId: string;
  evaluationPromptVersion?: string;
  evaluations: Array<
    Omit<EvaluationSummary, 'marker' | 'prompt'> & {
      version?: string;
    }
  >;
  openingSentence: string;
  promptVersionCreatedAt: string | null;
  prompt: string;
  promptVersionHash: string | null;
  promptVersionId: string | null;
  promptVersionLabel: string | null;
  promptVersions: PromptVersionSummary[];
  savedAt: string | null;
  source: 'evaluation';
  usingDefault: boolean;
};

export class EvaluationPromptSourceError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'EvaluationPromptSourceError';
    this.status = status;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractOpening(prompt: string): string | null {
  const lines = prompt.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() !== '# opening') continue;
    const openingLines: string[] = [];
    for (const candidate of lines.slice(index + 1)) {
      const stripped = candidate.trim();
      if (stripped.startsWith('#')) break;
      if (stripped) openingLines.push(stripped.replace(/^"|"$/g, ''));
    }
    return openingLines.join(' ').trim() || null;
  }
  return null;
}

function readStoredEvaluationPrompts(
  raw: PromptConfigFile | null
): Record<string, { prompt: string; promptId: string; savedAt: string | null }> {
  const prompts = raw?.evaluation?.evaluationPrompts;
  if (!prompts || typeof prompts !== 'object' || Array.isArray(prompts)) return {};

  const stored: Record<string, { prompt: string; promptId: string; savedAt: string | null }> = {};
  for (const [evaluationId, value] of Object.entries(prompts)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const source = value as StoredEvaluationPrompt;
    const prompt = text(source.prompt);
    if (!prompt) continue;
    stored[evaluationId] = {
      prompt,
      promptId: text(source.promptId) ?? `custom-${evaluationId}`,
      savedAt: text(source.savedAt),
    };
  }
  return stored;
}

async function readPromptConfigFile(): Promise<PromptConfigFile | null> {
  try {
    return JSON.parse(await readFile(PROMPT_CONFIG_PATH, 'utf-8')) as PromptConfigFile;
  } catch {
    return null;
  }
}

async function writePromptConfigFile(config: PromptConfigFile): Promise<void> {
  await mkdir(dirname(PROMPT_CONFIG_PATH), { recursive: true });
  const tempPath = `${PROMPT_CONFIG_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  await rename(tempPath, PROMPT_CONFIG_PATH);
}

async function readEvaluationVersionMetadata(): Promise<{
  activePromptVersionId: string | null;
  promptVersions: PromptVersionSummary[];
}> {
  const index = await readPromptVersionIndex();
  return {
    activePromptVersionId: index.active.evaluation ?? null,
    promptVersions: index.versions.evaluation,
  };
}

async function readEvaluationSummaries(): Promise<{
  defaultEvaluationId?: string;
  evaluations: EvaluationSummary[];
}> {
  const manifest = JSON.parse(
    await readFile(PROMPT_SOURCE_MANIFEST_PATH, 'utf-8')
  ) as EvaluationManifest;
  const evaluations =
    manifest.evaluations && typeof manifest.evaluations === 'object'
      ? (manifest.evaluations as Record<string, EvaluationManifestEntry>)
      : {};

  const evaluationSummaries = await Promise.all(
    Object.entries(evaluations).map(async ([id, entry]) => {
      const filename = text(entry.file);
      const marker = text(entry.marker);
      if (!filename || !marker) {
        throw new EvaluationPromptSourceError(`Evaluation prompt manifest entry is invalid: ${id}`);
      }
      const prompt = (await readFile(join(DEFAULT_PROMPT_SOURCE_DIR, filename), 'utf-8')).trim();
      if (!prompt.startsWith(marker)) {
        throw new EvaluationPromptSourceError(`Evaluation prompt marker mismatch: ${id}`);
      }
      return {
        id,
        character: text(entry.character) ?? 'Kate',
        file: filename,
        marker,
        prompt,
        promptId: text(entry.promptId) ?? id,
        version: text(entry.version) ?? undefined,
        openingSentence: extractOpening(prompt) ?? 'Hi, I’m Kate. I’m new here. Nice to meet you!',
      };
    })
  );

  return {
    defaultEvaluationId: text(manifest.defaultEvaluationId) ?? undefined,
    evaluations: evaluationSummaries,
  };
}

async function stateFromEvaluationVersion(
  version: PromptVersionFile<EvaluationVersionConfig>
): Promise<EvaluationPromptState> {
  const { evaluations } = await readEvaluationSummaries();
  const selected = evaluations.find((evaluation) => evaluation.id === version.config.evaluationId);
  if (!selected) {
    throw new EvaluationPromptSourceError(
      `Unknown evaluation prompt id: ${version.config.evaluationId}`,
      400
    );
  }
  const versionMetadata = await readEvaluationVersionMetadata();

  return {
    source: 'evaluation',
    usingDefault: false,
    evaluationId: selected.id,
    evaluationPromptId: version.id,
    evaluationPromptVersion: selected.version,
    evaluationCharacter: selected.character,
    openingSentence: extractOpening(version.config.prompt) ?? selected.openingSentence,
    prompt: version.config.prompt,
    savedAt: version.createdAt,
    activePromptVersionId: versionMetadata.activePromptVersionId,
    promptVersionCreatedAt: version.createdAt,
    promptVersionHash: version.hash,
    promptVersionId: version.id,
    promptVersionLabel: version.label,
    promptVersions: versionMetadata.promptVersions,
    evaluations: evaluations.map((evaluation) => ({
      id: evaluation.id,
      character: evaluation.character,
      file: evaluation.file,
      promptId: evaluation.promptId,
      version: evaluation.version,
      openingSentence: evaluation.openingSentence,
    })),
  };
}

export async function readEvaluationPromptState(options?: {
  evaluationId?: string;
  useDefault?: boolean;
  versionId?: string;
}): Promise<EvaluationPromptState> {
  const requestedEvaluationId = text(options?.evaluationId);
  const requestedVersion = options?.useDefault
    ? null
    : options?.versionId
      ? await readPromptVersion<EvaluationVersionConfig>('evaluation', options.versionId)
      : await readActivePromptVersion<EvaluationVersionConfig>('evaluation');
  if (
    requestedVersion &&
    (!requestedEvaluationId || requestedVersion.config.evaluationId === requestedEvaluationId)
  ) {
    return stateFromEvaluationVersion(requestedVersion);
  }

  const { defaultEvaluationId, evaluations } = await readEvaluationSummaries();
  const storedPrompts = options?.useDefault
    ? {}
    : readStoredEvaluationPrompts(await readPromptConfigFile());
  const versionMetadata = await readEvaluationVersionMetadata();
  const selectedEvaluationId = requestedEvaluationId ?? defaultEvaluationId ?? evaluations[0]?.id;
  const selected = evaluations.find((evaluation) => evaluation.id === selectedEvaluationId);

  if (!selected && requestedEvaluationId) {
    throw new EvaluationPromptSourceError(
      `Unknown evaluation prompt id: ${requestedEvaluationId}`,
      400
    );
  }

  if (!selected) {
    throw new EvaluationPromptSourceError('Evaluation prompt manifest has no evaluations.');
  }

  const stored = storedPrompts[selected.id];
  const prompt = stored?.prompt ?? selected.prompt;

  return {
    source: 'evaluation',
    usingDefault: !stored,
    evaluationId: selected.id,
    evaluationPromptId: stored?.promptId ?? selected.promptId,
    evaluationPromptVersion: selected.version,
    evaluationCharacter: selected.character,
    openingSentence: extractOpening(prompt) ?? selected.openingSentence,
    prompt,
    savedAt: stored?.savedAt ?? null,
    activePromptVersionId: versionMetadata.activePromptVersionId,
    promptVersionCreatedAt: null,
    promptVersionHash: null,
    promptVersionId: null,
    promptVersionLabel: null,
    promptVersions: versionMetadata.promptVersions,
    evaluations: evaluations.map((evaluation) => ({
      id: evaluation.id,
      character: evaluation.character,
      file: evaluation.file,
      promptId: evaluation.promptId,
      version: evaluation.version,
      openingSentence: evaluation.openingSentence,
    })),
  };
}

export async function writeEvaluationPromptOverride({
  evaluationId,
  label,
  prompt,
}: {
  evaluationId?: string;
  label?: string;
  prompt: unknown;
}): Promise<EvaluationPromptState> {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new EvaluationPromptSourceError('Evaluation prompt 값이 비어 있습니다.', 400);
  }

  const current = await readEvaluationPromptState({ evaluationId });
  const version = await createPromptVersion<EvaluationVersionConfig>({
    purpose: 'evaluation',
    label,
    config: {
      evaluationId: current.evaluationId,
      prompt: prompt.trim(),
    },
    activate: true,
  });

  return readEvaluationPromptState({ versionId: version.id });
}

export async function activateEvaluationPromptVersion(
  versionId: string
): Promise<EvaluationPromptState> {
  const version = await activatePromptVersion<EvaluationVersionConfig>('evaluation', versionId);
  if (!version) {
    throw new EvaluationPromptSourceError('Evaluation 프롬프트 버전을 찾을 수 없습니다.', 404);
  }
  return readEvaluationPromptState({ versionId });
}

export async function deleteEvaluationPromptOverride(options?: {
  evaluationId?: string;
  versionId?: string;
}): Promise<EvaluationPromptState> {
  if (options?.versionId) {
    await deletePromptVersion('evaluation', options.versionId);
    return readEvaluationPromptState({ evaluationId: options.evaluationId });
  }

  await clearActivePromptVersion('evaluation');
  const current = await readEvaluationPromptState({ evaluationId: options?.evaluationId });
  const raw = await readPromptConfigFile();
  const existingPrompts: Record<string, unknown> | null =
    raw?.evaluation?.evaluationPrompts &&
    typeof raw.evaluation.evaluationPrompts === 'object' &&
    !Array.isArray(raw.evaluation.evaluationPrompts)
      ? (raw.evaluation.evaluationPrompts as Record<string, unknown>)
      : null;

  if (!raw || !existingPrompts) {
    return readEvaluationPromptState({ evaluationId: current.evaluationId });
  }

  const nextPrompts = { ...existingPrompts };
  delete nextPrompts[current.evaluationId];
  const nextConfig: PromptConfigFile = {
    ...raw,
    evaluation: {
      ...(raw.evaluation ?? {}),
      evaluationPrompts: nextPrompts,
    },
  };

  if (Object.keys(nextPrompts).length === 0) {
    delete nextConfig.evaluation?.evaluationPrompts;
  }
  if (nextConfig.evaluation && Object.keys(nextConfig.evaluation).length === 0) {
    delete nextConfig.evaluation;
  }

  if (!nextConfig.evaluation && !nextConfig.realtime) {
    try {
      await unlink(PROMPT_CONFIG_PATH);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  } else {
    await writePromptConfigFile(nextConfig);
  }

  return readEvaluationPromptState({ evaluationId: current.evaluationId });
}
