import { createHash } from 'crypto';
import 'server-only';
import {
  type RealtimePromptConfig,
  type RealtimePromptMetadata,
  normalizeConditionCombinationPrompts,
  validateRealtimePromptConfig,
} from '@/lib/realtime-prompt-config';
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from '@/lib/supabase/admin';

export type PromptVersionPurpose = 'practice' | 'evaluation';

export type PromptVersionSummary = {
  id: string;
  label: string;
  createdAt: string;
  hash: string;
  taskCardId?: string;
};

type PromptVersionRow = {
  id?: unknown;
  purpose?: unknown;
  evaluation_id?: unknown;
  label?: unknown;
  hash?: unknown;
  is_active?: unknown;
  source?: unknown;
  base_prompt?: unknown;
  dominant_prompt?: unknown;
  collaborative_prompt?: unknown;
  feedback_condition_id?: unknown;
  feedback_prompt?: unknown;
  condition_combination_prompts?: unknown;
  task_card_id?: unknown;
  task_card_prompt?: unknown;
  task_character?: unknown;
  evaluation_prompt?: unknown;
  evaluation_prompt_version?: unknown;
  evaluation_character?: unknown;
  evaluation_opening_sentence?: unknown;
  legacy_file_version_id?: unknown;
  legacy_file_purpose?: unknown;
  created_at?: unknown;
  created_by?: unknown;
};

export type PracticePromptVersion = RealtimePromptConfig &
  RealtimePromptMetadata & {
    createdBy: string | null;
    hash: string;
    isActive: boolean;
    label: string;
    legacyFilePurpose: string | null;
    legacyFileVersionId: string | null;
    purpose: 'practice';
  };

export type EvaluationPromptVersion = {
  createdBy: string | null;
  evaluationCharacter: string;
  evaluationId: string;
  evaluationPromptId: string;
  evaluationPromptVersion: string | null;
  hash: string;
  isActive: boolean;
  label: string;
  legacyFilePurpose: string | null;
  legacyFileVersionId: string | null;
  openingSentence: string;
  prompt: string;
  promptId: string;
  promptVersionId: string;
  purpose: 'evaluation';
  savedAt: string | null;
  source: 'custom';
};

type PromptVersionStoreErrorCode =
  | 'supabase_not_configured'
  | 'prompt_version_invalid'
  | 'prompt_version_not_found'
  | 'prompt_version_read_failed'
  | 'prompt_version_write_failed';

export class PromptVersionStoreError extends Error {
  readonly code: PromptVersionStoreErrorCode;
  readonly status: number;

  constructor(code: PromptVersionStoreErrorCode, message: string, status = 503) {
    super(message);
    this.name = 'PromptVersionStoreError';
    this.code = code;
    this.status = status;
  }
}

const PROMPT_VERSION_COLUMNS = [
  'id',
  'purpose',
  'evaluation_id',
  'label',
  'hash',
  'is_active',
  'source',
  'base_prompt',
  'dominant_prompt',
  'collaborative_prompt',
  'feedback_condition_id',
  'feedback_prompt',
  'condition_combination_prompts',
  'task_card_id',
  'task_card_prompt',
  'task_character',
  'evaluation_prompt',
  'evaluation_prompt_version',
  'evaluation_character',
  'evaluation_opening_sentence',
  'legacy_file_version_id',
  'legacy_file_purpose',
  'created_at',
  'created_by',
].join(',');

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function missingSupabaseError() {
  return new PromptVersionStoreError(
    'supabase_not_configured',
    'Supabase prompt_versions is not configured.'
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashPromptVersionConfig(config: unknown): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

export function hashPracticePromptConfig(config: RealtimePromptConfig): string {
  return hashPromptVersionConfig({
    basePrompt: config.basePrompt,
    collaborativePrompt: config.collaborativePrompt,
    dominantPrompt: config.dominantPrompt,
    feedbackConditionId: config.feedbackConditionId,
    feedbackPrompt: config.feedbackPrompt,
    conditionCombinationPrompts: normalizeConditionCombinationPrompts(
      config.conditionCombinationPrompts
    ),
    taskCardId: config.taskCardId,
    taskCardPrompt: config.taskCardPrompt,
    taskCharacter: config.taskCharacter,
  });
}

export function hashEvaluationPromptConfig(config: {
  evaluationCharacter: string;
  evaluationId: string;
  evaluationPromptVersion?: string | null;
  openingSentence: string;
  prompt: string;
}): string {
  return hashPromptVersionConfig({
    evaluationCharacter: config.evaluationCharacter,
    evaluationId: config.evaluationId,
    evaluationPromptVersion: config.evaluationPromptVersion ?? null,
    openingSentence: config.openingSentence,
    prompt: config.prompt,
  });
}

function summaryFromRow(row: PromptVersionRow): PromptVersionSummary | null {
  const id = text(row.id);
  const createdAt = text(row.created_at);
  const hash = text(row.hash);
  const taskCardId = text(row.task_card_id);
  if (!id || !createdAt || !hash) return null;
  return {
    id,
    label: text(row.label) ?? `${text(row.purpose) ?? 'prompt'} ${createdAt}`,
    createdAt,
    hash,
    ...(taskCardId ? { taskCardId } : {}),
  };
}

function normalizeRpcRow(data: unknown): PromptVersionRow | null {
  if (Array.isArray(data)) {
    return (data[0] as PromptVersionRow | undefined) ?? null;
  }
  return data && typeof data === 'object' ? (data as PromptVersionRow) : null;
}

function rowToPracticeVersion(row: PromptVersionRow): PracticePromptVersion {
  if (row.purpose !== 'practice') {
    throw new PromptVersionStoreError(
      'prompt_version_not_found',
      'Practice prompt version not found.',
      404
    );
  }

  const result = validateRealtimePromptConfig({
    basePrompt: row.base_prompt,
    dominantPrompt: row.dominant_prompt,
    collaborativePrompt: row.collaborative_prompt,
    feedbackConditionId: row.feedback_condition_id,
    feedbackPrompt: row.feedback_prompt,
    conditionCombinationPrompts: row.condition_combination_prompts,
    taskCardId: row.task_card_id,
    taskCardPrompt: row.task_card_prompt,
    taskCharacter: row.task_character,
  });
  if (!result.ok) {
    throw new PromptVersionStoreError('prompt_version_invalid', result.error, 500);
  }

  const promptId = text(row.id);
  if (!promptId) {
    throw new PromptVersionStoreError(
      'prompt_version_invalid',
      'Prompt version id is missing.',
      500
    );
  }

  return {
    ...result.config,
    createdBy: text(row.created_by),
    hash: text(row.hash) ?? hashPracticePromptConfig(result.config),
    isActive: bool(row.is_active),
    label: text(row.label) ?? `practice ${text(row.created_at) ?? promptId}`,
    legacyFilePurpose: text(row.legacy_file_purpose),
    legacyFileVersionId: text(row.legacy_file_version_id),
    promptId,
    savedAt: text(row.created_at),
    source: 'custom',
    purpose: 'practice',
  };
}

function rowToEvaluationVersion(row: PromptVersionRow): EvaluationPromptVersion {
  if (row.purpose !== 'evaluation') {
    throw new PromptVersionStoreError(
      'prompt_version_not_found',
      'Evaluation prompt version not found.',
      404
    );
  }

  const id = text(row.id);
  const evaluationId = text(row.evaluation_id);
  const prompt = text(row.evaluation_prompt);
  const evaluationCharacter = text(row.evaluation_character);
  const openingSentence = text(row.evaluation_opening_sentence);
  if (!id || !evaluationId || !prompt || !evaluationCharacter || !openingSentence) {
    throw new PromptVersionStoreError(
      'prompt_version_invalid',
      'Evaluation prompt version row is invalid.',
      500
    );
  }

  return {
    createdBy: text(row.created_by),
    evaluationCharacter,
    evaluationId,
    evaluationPromptId: id,
    evaluationPromptVersion: text(row.evaluation_prompt_version),
    hash:
      text(row.hash) ??
      hashEvaluationPromptConfig({
        evaluationCharacter,
        evaluationId,
        evaluationPromptVersion: text(row.evaluation_prompt_version),
        openingSentence,
        prompt,
      }),
    isActive: bool(row.is_active),
    label: text(row.label) ?? `evaluation ${text(row.created_at) ?? id}`,
    legacyFilePurpose: text(row.legacy_file_purpose),
    legacyFileVersionId: text(row.legacy_file_version_id),
    openingSentence,
    prompt,
    promptId: id,
    promptVersionId: id,
    purpose: 'evaluation',
    savedAt: text(row.created_at),
    source: 'custom',
  };
}

async function readVersionRow(
  versionId: string,
  expectedPurpose?: PromptVersionPurpose
): Promise<PromptVersionRow | null> {
  if (!hasSupabaseAdminEnv()) return null;
  const supabase = createSupabaseAdminClient();
  let query = supabase.from('prompt_versions').select(PROMPT_VERSION_COLUMNS).eq('id', versionId);
  if (expectedPurpose) query = query.eq('purpose', expectedPurpose);
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_read_failed',
      'Supabase prompt_versions could not be read.'
    );
  }

  return data ? (data as PromptVersionRow) : null;
}

async function readActiveVersionRow(
  purpose: PromptVersionPurpose,
  evaluationId?: string
): Promise<PromptVersionRow | null> {
  if (!hasSupabaseAdminEnv()) return null;
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from('prompt_versions')
    .select(PROMPT_VERSION_COLUMNS)
    .eq('purpose', purpose)
    .eq('is_active', true);
  if (purpose === 'evaluation') {
    query = query.eq('evaluation_id', evaluationId ?? '');
  }
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_read_failed',
      'Supabase prompt_versions could not be read.'
    );
  }

  return data ? (data as PromptVersionRow) : null;
}

export async function listPromptVersions(
  purpose: PromptVersionPurpose,
  options: { evaluationId?: string } = {}
): Promise<PromptVersionSummary[]> {
  if (!hasSupabaseAdminEnv()) return [];
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from('prompt_versions')
    .select(PROMPT_VERSION_COLUMNS)
    .eq('purpose', purpose);
  if (purpose === 'evaluation') {
    query = query.eq('evaluation_id', options.evaluationId ?? '');
  }
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_read_failed',
      'Supabase prompt_versions could not be read.'
    );
  }

  return Array.isArray(data)
    ? data.flatMap((row) => {
        const summary = summaryFromRow(row as PromptVersionRow);
        return summary ? [summary] : [];
      })
    : [];
}

export async function readPracticePromptVersion(
  versionId: string
): Promise<PracticePromptVersion | null> {
  const row = await readVersionRow(versionId, 'practice');
  return row ? rowToPracticeVersion(row) : null;
}

export async function readActivePracticePromptVersion(): Promise<PracticePromptVersion | null> {
  const row = await readActiveVersionRow('practice');
  return row ? rowToPracticeVersion(row) : null;
}

export async function savePracticePromptVersion(
  config: RealtimePromptConfig,
  options: { createdBy?: string | null; label?: string | null } = {}
): Promise<PracticePromptVersion> {
  if (!hasSupabaseAdminEnv()) throw missingSupabaseError();
  const supabase = createSupabaseAdminClient();
  const hash = hashPracticePromptConfig(config);
  const { data, error } = await supabase.rpc('save_practice_prompt_version', {
    p_base_prompt: config.basePrompt,
    p_collaborative_prompt: config.collaborativePrompt,
    p_created_by: options.createdBy ?? null,
    p_dominant_prompt: config.dominantPrompt,
    p_feedback_condition_id: config.feedbackConditionId,
    p_feedback_prompt: config.feedbackPrompt,
    p_condition_combination_prompts: normalizeConditionCombinationPrompts(
      config.conditionCombinationPrompts
    ),
    p_hash: hash,
    p_label: options.label ?? null,
    p_task_card_id: config.taskCardId,
    p_task_card_prompt: config.taskCardPrompt,
    p_task_character: config.taskCharacter,
  });

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_write_failed',
      'Supabase prompt_versions could not be written.'
    );
  }

  const row = normalizeRpcRow(data);
  if (!row) {
    throw new PromptVersionStoreError(
      'prompt_version_write_failed',
      'Supabase prompt_versions did not return the saved version.'
    );
  }
  return rowToPracticeVersion(row);
}

export async function activatePracticePromptVersion(
  versionId: string
): Promise<PracticePromptVersion> {
  const row = await activatePromptVersionRow(versionId, 'practice');
  return rowToPracticeVersion(row);
}

export async function readEvaluationPromptVersion(
  versionId: string
): Promise<EvaluationPromptVersion | null> {
  const row = await readVersionRow(versionId, 'evaluation');
  return row ? rowToEvaluationVersion(row) : null;
}

export async function readActiveEvaluationPromptVersion(
  evaluationId: string
): Promise<EvaluationPromptVersion | null> {
  const row = await readActiveVersionRow('evaluation', evaluationId);
  return row ? rowToEvaluationVersion(row) : null;
}

export async function saveEvaluationPromptVersion(
  config: {
    evaluationCharacter: string;
    evaluationId: string;
    evaluationPromptVersion?: string | null;
    legacyFilePurpose?: string | null;
    legacyFileVersionId?: string | null;
    openingSentence: string;
    prompt: string;
  },
  options: { createdBy?: string | null; label?: string | null } = {}
): Promise<EvaluationPromptVersion> {
  if (!hasSupabaseAdminEnv()) throw missingSupabaseError();
  const supabase = createSupabaseAdminClient();
  const hash = hashEvaluationPromptConfig(config);
  const { data, error } = await supabase.rpc('save_evaluation_prompt_version', {
    p_created_by: options.createdBy ?? null,
    p_evaluation_character: config.evaluationCharacter,
    p_evaluation_id: config.evaluationId,
    p_evaluation_opening_sentence: config.openingSentence,
    p_evaluation_prompt: config.prompt,
    p_evaluation_prompt_version: config.evaluationPromptVersion ?? null,
    p_hash: hash,
    p_label: options.label ?? null,
    p_legacy_file_purpose: config.legacyFilePurpose ?? null,
    p_legacy_file_version_id: config.legacyFileVersionId ?? null,
  });

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_write_failed',
      'Supabase prompt_versions could not be written.'
    );
  }

  const row = normalizeRpcRow(data);
  if (!row) {
    throw new PromptVersionStoreError(
      'prompt_version_write_failed',
      'Supabase prompt_versions did not return the saved version.'
    );
  }
  return rowToEvaluationVersion(row);
}

export async function activateEvaluationPromptVersion(
  versionId: string
): Promise<EvaluationPromptVersion> {
  const row = await activatePromptVersionRow(versionId, 'evaluation');
  return rowToEvaluationVersion(row);
}

async function activatePromptVersionRow(
  versionId: string,
  expectedPurpose: PromptVersionPurpose
): Promise<PromptVersionRow> {
  if (!hasSupabaseAdminEnv()) throw missingSupabaseError();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc('activate_prompt_version', {
    p_expected_purpose: expectedPurpose,
    p_version_id: versionId,
  });

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_write_failed',
      'Supabase prompt_versions could not be activated.'
    );
  }

  const row = normalizeRpcRow(data);
  if (!row) {
    throw new PromptVersionStoreError(
      'prompt_version_not_found',
      'Prompt version was not found.',
      404
    );
  }
  return row;
}

export async function deletePromptVersion(
  versionId: string,
  expectedPurpose: PromptVersionPurpose
): Promise<void> {
  if (!hasSupabaseAdminEnv()) throw missingSupabaseError();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc('delete_prompt_version', {
    p_expected_purpose: expectedPurpose,
    p_version_id: versionId,
  });

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_write_failed',
      'Supabase prompt_versions could not be deleted.'
    );
  }
}

export async function clearActivePromptVersion(
  purpose: PromptVersionPurpose,
  options: { evaluationId?: string | null } = {}
): Promise<void> {
  if (!hasSupabaseAdminEnv()) return;
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc('clear_active_prompt_versions', {
    p_evaluation_id: options.evaluationId ?? null,
    p_purpose: purpose,
  });

  if (error) {
    throw new PromptVersionStoreError(
      'prompt_version_write_failed',
      'Supabase prompt_versions could not be cleared.'
    );
  }
}
