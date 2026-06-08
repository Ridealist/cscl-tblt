export interface RealtimePromptConfig {
  basePrompt: string;
  dominantPrompt: string;
  collaborativePrompt: string;
  feedbackConditionId: string;
  feedbackPrompt: string;
  taskCardId: string;
  taskCardPrompt: string;
}

export interface RealtimeFeedbackConditionSummary {
  id: string;
  title: string;
  prompt: string;
}

export type RealtimeFeedbackExamples = Record<
  string,
  {
    file: string;
    marker: string;
    prompt: string;
  }
>;

export interface RealtimeTaskCardSummary {
  id: string;
  title: string;
  topic: string | null;
  level: string | null;
  prompt: string;
  examples?: {
    dominant?: RealtimeFeedbackExamples;
    collaborative?: RealtimeFeedbackExamples;
  };
}

export type RealtimePromptSource = 'default' | 'custom';

export interface RealtimePromptMetadata {
  promptId: string;
  savedAt: string | null;
  source: RealtimePromptSource;
}

export type RealtimePromptState = RealtimePromptConfig &
  RealtimePromptMetadata & {
    feedbackConditions: RealtimeFeedbackConditionSummary[];
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
      | 'taskCardId'
      | 'taskCardPrompt',
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
    config[field] = text.trim();
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

  const taskCardId =
    typeof source.taskCardId === 'string' && source.taskCardId.trim()
      ? source.taskCardId.trim()
      : 'school_event_invitation';
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

  return { ok: true, config };
}
