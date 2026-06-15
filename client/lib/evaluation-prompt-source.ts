import { readFile } from 'fs/promises';
import { join } from 'path';
import 'server-only';

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

export type EvaluationPromptState = {
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
  prompt: string;
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

export async function readEvaluationPromptState(options?: {
  evaluationId?: string;
}): Promise<EvaluationPromptState> {
  const { defaultEvaluationId, evaluations } = await readEvaluationSummaries();
  const requestedEvaluationId = text(options?.evaluationId);
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

  return {
    source: 'evaluation',
    usingDefault: !requestedEvaluationId,
    evaluationId: selected.id,
    evaluationPromptId: selected.promptId,
    evaluationPromptVersion: selected.version,
    evaluationCharacter: selected.character,
    openingSentence: selected.openingSentence,
    prompt: selected.prompt,
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
