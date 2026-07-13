import {
  KATE_TASK_CHARACTER,
  type RealtimeTaskCharacter,
  inferRealtimeTaskCharacter,
  normalizeRealtimeTaskCharacter,
} from '@/lib/agent-character';

export interface RealtimePromptConfig {
  basePrompt: string;
  dominantPrompt: string;
  collaborativePrompt: string;
  feedbackConditionId: string;
  feedbackPrompt: string;
  conditionCombinationPrompts: ConditionCombinationPrompts;
  taskCardId: string;
  taskCardPrompt: string;
  taskCharacter: RealtimeTaskCharacter;
}

export const CONDITION_COMBINATION_PROMPT_KEYS = [
  'dominant_no_feedback',
  'dominant_explicit_correction',
  'collaborative_no_feedback',
  'collaborative_explicit_correction',
] as const;

export type ConditionCombinationPromptKey = (typeof CONDITION_COMBINATION_PROMPT_KEYS)[number];

export type ConditionCombinationPrompts = Record<ConditionCombinationPromptKey, string>;

const CONDITION_COMBINATION_PROMPT_ALIASES: Partial<
  Record<ConditionCombinationPromptKey, string[]>
> = {
  dominant_no_feedback: ['dominant_no_corrective'],
  collaborative_no_feedback: ['collaborative_no_corrective'],
};

export interface RealtimeFeedbackConditionSummary {
  id: string;
  title: string;
  prompt: string;
}

export interface RealtimeTaskCardSummary {
  id: string;
  characterId: string;
  title: string;
  topic: string | null;
  level: string | null;
  prompt: string;
}

export type RealtimePromptSource = 'default' | 'custom';

export interface RealtimePromptMetadata {
  promptId: string;
  savedAt: string | null;
  source: RealtimePromptSource;
}

export interface RealtimePromptVersionSummary {
  id: string;
  label: string;
  createdAt: string;
  hash: string;
  taskCardId?: string;
}

export type RealtimePromptState = RealtimePromptConfig &
  RealtimePromptMetadata & {
    activePromptVersionId: string | null;
    feedbackConditions: RealtimeFeedbackConditionSummary[];
    promptVersionCreatedAt: string | null;
    promptVersionHash: string | null;
    promptVersionId: string | null;
    promptVersionLabel: string | null;
    promptVersions: RealtimePromptVersionSummary[];
    taskCards: RealtimeTaskCardSummary[];
    usingDefault: boolean;
  };

export const REALTIME_PROMPT_MAX_CHARS = 40_000;
export const DEFAULT_REALTIME_PROMPT_METADATA: RealtimePromptMetadata = {
  promptId: 'default',
  savedAt: null,
  source: 'default',
};

const PROMPT_FIELDS = ['basePrompt', 'dominantPrompt', 'collaborativePrompt'] as const;

function stripObsoletePromptStackLines(prompt: string) {
  return prompt
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '4. ONE Conversation Example, when available')
    .join('\n')
    .trim();
}

function normalizePromptFieldText(field: (typeof PROMPT_FIELDS)[number], text: string) {
  const trimmed = text.trim();
  return field === 'basePrompt' ? stripObsoletePromptStackLines(trimmed) : trimmed;
}

export function normalizeConditionCombinationPrompts(value: unknown): ConditionCombinationPrompts {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    CONDITION_COMBINATION_PROMPT_KEYS.map((key) => {
      const candidates = [key, ...(CONDITION_COMBINATION_PROMPT_ALIASES[key] ?? [])];
      const text = candidates
        .map((candidate) => (source as Record<string, unknown>)[candidate])
        .find((candidate) => typeof candidate === 'string' && candidate.trim());
      return [key, typeof text === 'string' ? text.trim() : ''];
    })
  ) as ConditionCombinationPrompts;
}

export function validateRealtimePromptConfig(
  value: unknown
): { ok: true; config: RealtimePromptConfig } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: '프롬프트 설정 형식이 올바르지 않습니다.' };
  }

  const source = value as Partial<
    Record<
      | (typeof PROMPT_FIELDS)[number]
      | 'passivePrompt'
      | 'feedbackConditionId'
      | 'feedbackPrompt'
      | 'conditionCombinationPrompts'
      | 'taskCardId'
      | 'taskCardPrompt'
      | 'taskCharacter',
      unknown
    >
  >;
  const config = {} as RealtimePromptConfig;

  for (const field of PROMPT_FIELDS) {
    const text =
      field === 'collaborativePrompt' ? (source[field] ?? source.passivePrompt) : source[field];
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: `${field} 값이 비어 있습니다.` };
    }
    if (text.length > REALTIME_PROMPT_MAX_CHARS) {
      return {
        ok: false,
        error: `${field} 값은 ${REALTIME_PROMPT_MAX_CHARS.toLocaleString('ko-KR')}자 이하여야 합니다.`,
      };
    }
    config[field] = normalizePromptFieldText(field, text);
  }

  const feedbackConditionId =
    typeof source.feedbackConditionId === 'string' && source.feedbackConditionId.trim()
      ? source.feedbackConditionId.trim()
      : 'no_corrective';
  const feedbackPrompt = source.feedbackPrompt;
  if (typeof feedbackPrompt !== 'string' || !feedbackPrompt.trim()) {
    return { ok: false, error: 'feedbackPrompt 값이 비어 있습니다.' };
  }
  if (feedbackPrompt.length > REALTIME_PROMPT_MAX_CHARS) {
    return {
      ok: false,
      error: `feedbackPrompt 값은 ${REALTIME_PROMPT_MAX_CHARS.toLocaleString('ko-KR')}자 이하여야 합니다.`,
    };
  }
  config.feedbackConditionId = feedbackConditionId;
  config.feedbackPrompt = feedbackPrompt.trim();
  config.conditionCombinationPrompts = normalizeConditionCombinationPrompts(
    source.conditionCombinationPrompts
  );

  const taskCardId =
    typeof source.taskCardId === 'string' && source.taskCardId.trim()
      ? source.taskCardId.trim()
      : 'special_activity_plan';
  const taskCardPrompt = source.taskCardPrompt;
  if (typeof taskCardPrompt !== 'string' || !taskCardPrompt.trim()) {
    return { ok: false, error: 'taskCardPrompt 값이 비어 있습니다.' };
  }
  if (taskCardPrompt.length > REALTIME_PROMPT_MAX_CHARS) {
    return {
      ok: false,
      error: `taskCardPrompt 값은 ${REALTIME_PROMPT_MAX_CHARS.toLocaleString('ko-KR')}자 이하여야 합니다.`,
    };
  }
  config.taskCardId = taskCardId;
  config.taskCardPrompt = taskCardPrompt.trim();
  config.taskCharacter =
    normalizeRealtimeTaskCharacter(source.taskCharacter) ??
    inferRealtimeTaskCharacter(config.taskCardPrompt) ??
    KATE_TASK_CHARACTER;

  return { ok: true, config };
}
