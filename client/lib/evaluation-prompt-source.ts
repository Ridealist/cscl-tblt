import { readFile } from 'fs/promises';
import { join } from 'path';
import 'server-only';
import {
  type EvaluationPromptVersion,
  type PromptVersionSummary,
  activateEvaluationPromptVersion as activateDbEvaluationPromptVersion,
  clearActivePromptVersion,
  deletePromptVersion,
  listPromptVersions,
  readActiveEvaluationPromptVersion,
  readEvaluationPromptVersion,
  saveEvaluationPromptVersion,
} from '@/lib/prompt-version-db-store';

const DEFAULT_PROMPT_SOURCE_DIR = join(process.cwd(), '..', 'prompts', 'evaluation');
const PROMPT_SOURCE_MANIFEST_PATH = join(DEFAULT_PROMPT_SOURCE_DIR, 'manifest.json');

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

type EvaluationOption = Omit<EvaluationSummary, 'marker' | 'prompt'> & {
  version?: string;
};

export type EvaluationPromptState = {
  activePromptVersionId: string | null;
  evaluationCharacter: string;
  evaluationId: string;
  evaluationPromptId: string;
  evaluationPromptVersion?: string;
  evaluations: EvaluationOption[];
  openingSentence: string;
  prompt: string;
  promptVersionCreatedAt: string | null;
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
        character: text(entry.character) ?? 'Jack',
        file: filename,
        marker,
        prompt,
        promptId: text(entry.promptId) ?? id,
        version: text(entry.version) ?? undefined,
        openingSentence:
          extractOpening(prompt) ?? 'Hi, I’m Jack. I just moved to Korea. Nice to meet you!',
      };
    })
  );

  return {
    defaultEvaluationId: text(manifest.defaultEvaluationId) ?? undefined,
    evaluations: evaluationSummaries,
  };
}

function evaluationOptions(
  evaluations: EvaluationSummary[],
  selectedFallback?: EvaluationOption
): EvaluationOption[] {
  const options = evaluations.map((evaluation) => ({
    id: evaluation.id,
    character: evaluation.character,
    file: evaluation.file,
    promptId: evaluation.promptId,
    version: evaluation.version,
    openingSentence: evaluation.openingSentence,
  }));
  if (selectedFallback && !options.some((option) => option.id === selectedFallback.id)) {
    return [selectedFallback, ...options];
  }
  return options;
}

async function readEvaluationVersionMetadata(evaluationId: string): Promise<{
  activePromptVersionId: string | null;
  promptVersions: PromptVersionSummary[];
}> {
  const [activeVersion, promptVersions] = await Promise.all([
    readActiveEvaluationPromptVersion(evaluationId),
    listPromptVersions('evaluation', { evaluationId }),
  ]);
  return {
    activePromptVersionId: activeVersion?.promptVersionId ?? null,
    promptVersions,
  };
}

function fallbackSummaryForVersion(version: EvaluationPromptVersion): EvaluationOption {
  return {
    id: version.evaluationId,
    character: version.evaluationCharacter,
    file: '',
    promptId: version.evaluationPromptId,
    version: version.evaluationPromptVersion ?? undefined,
    openingSentence: version.openingSentence,
  };
}

async function stateFromEvaluationVersion(
  version: EvaluationPromptVersion,
  evaluations: EvaluationSummary[],
  metadata?: {
    activePromptVersionId: string | null;
    promptVersions: PromptVersionSummary[];
  }
): Promise<EvaluationPromptState> {
  const selected = evaluations.find((evaluation) => evaluation.id === version.evaluationId);
  const fallback = selected ? undefined : fallbackSummaryForVersion(version);
  const versionMetadata = metadata ?? (await readEvaluationVersionMetadata(version.evaluationId));

  return {
    source: 'evaluation',
    usingDefault: false,
    evaluationId: version.evaluationId,
    evaluationPromptId: version.evaluationPromptId,
    evaluationPromptVersion: version.evaluationPromptVersion ?? selected?.version,
    evaluationCharacter: version.evaluationCharacter,
    openingSentence: extractOpening(version.prompt) ?? version.openingSentence,
    prompt: version.prompt,
    savedAt: version.savedAt,
    activePromptVersionId: versionMetadata.activePromptVersionId,
    promptVersionCreatedAt: version.savedAt,
    promptVersionHash: version.hash,
    promptVersionId: version.promptVersionId,
    promptVersionLabel: version.label,
    promptVersions: versionMetadata.promptVersions,
    evaluations: evaluationOptions(evaluations, fallback),
  };
}

function defaultEvaluationState(
  selected: EvaluationSummary,
  evaluations: EvaluationSummary[],
  metadata: {
    activePromptVersionId: string | null;
    promptVersions: PromptVersionSummary[];
  }
): EvaluationPromptState {
  return {
    source: 'evaluation',
    usingDefault: true,
    evaluationId: selected.id,
    evaluationPromptId: selected.promptId,
    evaluationPromptVersion: selected.version,
    evaluationCharacter: selected.character,
    openingSentence: selected.openingSentence,
    prompt: selected.prompt,
    savedAt: null,
    activePromptVersionId: metadata.activePromptVersionId,
    promptVersionCreatedAt: null,
    promptVersionHash: null,
    promptVersionId: null,
    promptVersionLabel: null,
    promptVersions: metadata.promptVersions,
    evaluations: evaluationOptions(evaluations),
  };
}

function selectEvaluation(
  evaluations: EvaluationSummary[],
  requestedEvaluationId?: string | null,
  defaultEvaluationId?: string
): EvaluationSummary {
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

  return selected;
}

export async function readEvaluationPromptState(options?: {
  evaluationId?: string;
  useDefault?: boolean;
  versionId?: string;
}): Promise<EvaluationPromptState> {
  const requestedEvaluationId = text(options?.evaluationId);
  const { defaultEvaluationId, evaluations } = await readEvaluationSummaries();

  if (!options?.useDefault && options?.versionId) {
    const requestedVersionId = text(options.versionId);
    const version = requestedVersionId
      ? await readEvaluationPromptVersion(requestedVersionId)
      : null;
    if (!version) {
      throw new EvaluationPromptSourceError('Evaluation 프롬프트 버전을 찾을 수 없습니다.', 404);
    }
    if (requestedEvaluationId && version.evaluationId !== requestedEvaluationId) {
      throw new EvaluationPromptSourceError(
        `Evaluation 프롬프트 버전이 요청한 evaluationId와 일치하지 않습니다: ${requestedEvaluationId}`,
        400
      );
    }
    return stateFromEvaluationVersion(version, evaluations);
  }

  const selected = selectEvaluation(evaluations, requestedEvaluationId, defaultEvaluationId);
  const metadata = await readEvaluationVersionMetadata(selected.id);
  const activeVersion = options?.useDefault
    ? null
    : await readActiveEvaluationPromptVersion(selected.id);

  if (activeVersion) {
    return stateFromEvaluationVersion(activeVersion, evaluations, metadata);
  }

  return defaultEvaluationState(selected, evaluations, metadata);
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

  const current = await readEvaluationPromptState({ evaluationId, useDefault: true });
  const trimmedPrompt = prompt.trim();
  const version = await saveEvaluationPromptVersion(
    {
      evaluationCharacter: current.evaluationCharacter,
      evaluationId: current.evaluationId,
      evaluationPromptVersion: current.evaluationPromptVersion ?? null,
      openingSentence: extractOpening(trimmedPrompt) ?? current.openingSentence,
      prompt: trimmedPrompt,
    },
    { label }
  );

  return readEvaluationPromptState({ versionId: version.promptVersionId });
}

export async function activateEvaluationPromptVersion(
  versionId: string
): Promise<EvaluationPromptState> {
  const requestedVersionId = text(versionId);
  if (!requestedVersionId) {
    throw new EvaluationPromptSourceError('Evaluation 프롬프트 버전을 찾을 수 없습니다.', 404);
  }
  const version = await activateDbEvaluationPromptVersion(requestedVersionId);
  return readEvaluationPromptState({ versionId: version.promptVersionId });
}

export async function deleteEvaluationPromptOverride(options?: {
  evaluationId?: string;
  versionId?: string;
}): Promise<EvaluationPromptState> {
  if (options?.versionId) {
    const existing = await readEvaluationPromptVersion(options.versionId);
    const evaluationId = text(options.evaluationId) ?? existing?.evaluationId;
    await deletePromptVersion(options.versionId, 'evaluation');
    return readEvaluationPromptState({ evaluationId });
  }

  const current = await readEvaluationPromptState({
    evaluationId: options?.evaluationId,
    useDefault: true,
  });
  await clearActivePromptVersion('evaluation', { evaluationId: current.evaluationId });
  return readEvaluationPromptState({ evaluationId: current.evaluationId, useDefault: true });
}
