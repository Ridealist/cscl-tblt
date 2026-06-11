import 'server-only';
import {
  type RealtimePromptConfig,
  type RealtimePromptMetadata,
  validateRealtimePromptConfig,
} from '@/lib/realtime-prompt-config';
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from '@/lib/supabase/admin';

type RealtimePromptVersionRow = {
  id?: unknown;
  base_prompt?: unknown;
  dominant_prompt?: unknown;
  collaborative_prompt?: unknown;
  feedback_condition_id?: unknown;
  feedback_prompt?: unknown;
  task_card_id?: unknown;
  task_card_prompt?: unknown;
  source?: unknown;
  is_active?: unknown;
  created_at?: unknown;
  created_by?: unknown;
};

export type RealtimePromptVersion = RealtimePromptConfig &
  RealtimePromptMetadata & {
    createdBy: string | null;
    isActive: boolean;
  };

type RealtimePromptStoreErrorCode =
  | 'supabase_not_configured'
  | 'prompt_version_invalid'
  | 'prompt_version_read_failed'
  | 'prompt_version_write_failed';

export class RealtimePromptStoreError extends Error {
  readonly code: RealtimePromptStoreErrorCode;
  readonly status: number;

  constructor(code: RealtimePromptStoreErrorCode, message: string, status = 503) {
    super(message);
    this.name = 'RealtimePromptStoreError';
    this.code = code;
    this.status = status;
  }
}

const ACTIVE_PROMPT_COLUMNS = [
  'id',
  'base_prompt',
  'dominant_prompt',
  'collaborative_prompt',
  'feedback_condition_id',
  'feedback_prompt',
  'task_card_id',
  'task_card_prompt',
  'source',
  'is_active',
  'created_at',
  'created_by',
].join(',');

function missingSupabaseError() {
  return new RealtimePromptStoreError(
    'supabase_not_configured',
    'Supabase realtime_prompt_versions is not configured.'
  );
}

function rowToPromptVersion(row: RealtimePromptVersionRow): RealtimePromptVersion {
  const result = validateRealtimePromptConfig({
    basePrompt: row.base_prompt,
    dominantPrompt: row.dominant_prompt,
    collaborativePrompt: row.collaborative_prompt,
    feedbackConditionId: row.feedback_condition_id,
    feedbackPrompt: row.feedback_prompt,
    taskCardId: row.task_card_id,
    taskCardPrompt: row.task_card_prompt,
  });
  if (!result.ok) {
    throw new RealtimePromptStoreError('prompt_version_invalid', result.error, 500);
  }

  const promptId = typeof row.id === 'string' && row.id ? row.id : 'custom-unknown';
  return {
    ...result.config,
    promptId,
    savedAt: typeof row.created_at === 'string' && row.created_at ? row.created_at : null,
    source: 'custom',
    createdBy: typeof row.created_by === 'string' && row.created_by ? row.created_by : null,
    isActive: row.is_active === true,
  };
}

function normalizeRpcRow(data: unknown): RealtimePromptVersionRow | null {
  if (Array.isArray(data)) {
    return (data[0] as RealtimePromptVersionRow | undefined) ?? null;
  }
  return data && typeof data === 'object' ? (data as RealtimePromptVersionRow) : null;
}

export async function readActiveRealtimePromptVersion(): Promise<RealtimePromptVersion | null> {
  if (!hasSupabaseAdminEnv()) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('realtime_prompt_versions')
    .select(ACTIVE_PROMPT_COLUMNS)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new RealtimePromptStoreError(
      'prompt_version_read_failed',
      'Supabase realtime_prompt_versions could not be read.'
    );
  }

  return data ? rowToPromptVersion(data as RealtimePromptVersionRow) : null;
}

export async function saveRealtimePromptVersion(
  config: RealtimePromptConfig,
  options: { createdBy?: string | null } = {}
): Promise<RealtimePromptVersion> {
  if (!hasSupabaseAdminEnv()) {
    throw missingSupabaseError();
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc('activate_realtime_prompt_version', {
    p_base_prompt: config.basePrompt,
    p_dominant_prompt: config.dominantPrompt,
    p_collaborative_prompt: config.collaborativePrompt,
    p_feedback_condition_id: config.feedbackConditionId,
    p_feedback_prompt: config.feedbackPrompt,
    p_task_card_id: config.taskCardId,
    p_task_card_prompt: config.taskCardPrompt,
    p_created_by: options.createdBy ?? null,
  });

  if (error) {
    throw new RealtimePromptStoreError(
      'prompt_version_write_failed',
      'Supabase realtime_prompt_versions could not be written.'
    );
  }

  const row = normalizeRpcRow(data);
  if (!row) {
    throw new RealtimePromptStoreError(
      'prompt_version_write_failed',
      'Supabase realtime_prompt_versions did not return the saved version.'
    );
  }

  return rowToPromptVersion(row);
}

export async function deactivateActiveRealtimePromptVersion(): Promise<void> {
  if (!hasSupabaseAdminEnv()) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc('deactivate_realtime_prompt_versions');

  if (error) {
    throw new RealtimePromptStoreError(
      'prompt_version_write_failed',
      'Supabase realtime_prompt_versions could not be deactivated.'
    );
  }
}
