export interface RealtimePromptConfig {
  basePrompt: string;
  dominantPrompt: string;
  passivePrompt: string;
}

export type RealtimePromptSource = 'default' | 'custom';

export interface RealtimePromptMetadata {
  promptId: string;
  savedAt: string | null;
  source: RealtimePromptSource;
}

export type RealtimePromptState = RealtimePromptConfig &
  RealtimePromptMetadata & {
    usingDefault: boolean;
  };

export const REALTIME_PROMPT_MAX_CHARS = 40_000;
export const DEFAULT_REALTIME_PROMPT_METADATA: RealtimePromptMetadata = {
  promptId: 'default',
  savedAt: null,
  source: 'default',
};

const PROMPT_FIELDS = ['basePrompt', 'dominantPrompt', 'passivePrompt'] as const;

export function validateRealtimePromptConfig(
  value: unknown
): { ok: true; config: RealtimePromptConfig } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: '프롬프트 설정 형식이 올바르지 않습니다.' };
  }

  const source = value as Partial<Record<(typeof PROMPT_FIELDS)[number], unknown>>;
  const config = {} as RealtimePromptConfig;

  for (const field of PROMPT_FIELDS) {
    const text = source[field];
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

  return { ok: true, config };
}
