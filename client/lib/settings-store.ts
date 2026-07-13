import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import 'server-only';
import { type AgentMode, normalizeAgentMode } from '@/lib/agent-mode';
import type { AgentRole } from '@/lib/agent-role';
import { type SessionPurpose, normalizeSessionPurpose } from '@/lib/session-activity';
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from '@/lib/supabase/admin';

const SETTINGS_ID = 'default';
const CONFIG_PATH = join(process.cwd(), '..', 'config.json');
const DEFAULT_FEEDBACK_CONDITION_ID = 'no_corrective';
const FIXED_AGENT_ROLE: AgentRole = 'collaborative';

export interface AppSettings {
  numClasses: number;
  numGroupsPerClass: number;
  classStart: number;
  activeClass: number;
  agentMode: AgentMode;
  agentRole: AgentRole;
  feedbackConditionId: string;
  sessionPurpose: SessionPurpose;
  realtimeResetting: boolean;
}

type AppSettingsRow = {
  id?: unknown;
  num_classes?: unknown;
  num_groups_per_class?: unknown;
  class_start?: unknown;
  active_class?: unknown;
  agent_mode?: unknown;
  agent_role?: unknown;
  feedback_condition_id?: unknown;
  session_purpose?: unknown;
  realtime_resetting?: unknown;
  updated_by?: unknown;
};

type SettingsStoreErrorCode =
  | 'supabase_not_configured'
  | 'settings_read_failed'
  | 'settings_write_failed';

export class SettingsStoreError extends Error {
  readonly code: SettingsStoreErrorCode;
  readonly status: number;

  constructor(code: SettingsStoreErrorCode, message: string, status = 503) {
    super(message);
    this.name = 'SettingsStoreError';
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  numClasses: 4,
  numGroupsPerClass: 4,
  classStart: 1,
  activeClass: 1,
  agentMode: 'pipeline',
  agentRole: FIXED_AGENT_ROLE,
  feedbackConditionId: DEFAULT_FEEDBACK_CONDITION_ID,
  sessionPurpose: 'practice',
  realtimeResetting: false,
};

export type SettingsNormalizationOptions = {
  feedbackConditionIds?: string[];
};

type WriteSettingsOptions = SettingsNormalizationOptions & {
  updatedBy?: string | null;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

function normalizeFeedbackConditionId(
  value: unknown,
  options: SettingsNormalizationOptions = {}
): string {
  const availableIds = options.feedbackConditionIds?.filter(Boolean) ?? [];
  const fallback = availableIds.includes(DEFAULT_FEEDBACK_CONDITION_ID)
    ? DEFAULT_FEEDBACK_CONDITION_ID
    : (availableIds[0] ?? DEFAULT_FEEDBACK_CONDITION_ID);

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const candidate = value.trim();
  return availableIds.length === 0 || availableIds.includes(candidate) ? candidate : fallback;
}

function clampActiveClass(value: unknown, classStart: number, numClasses: number): number {
  const classEnd = classStart + numClasses - 1;
  const activeClass = isPositiveInteger(value) ? value : classStart;
  return Math.min(Math.max(activeClass, classStart), classEnd);
}

export function normalizeSettings(
  value: Partial<AppSettings> & { agentStance?: unknown } = {},
  options: SettingsNormalizationOptions = {}
): AppSettings {
  const numClasses = normalizePositiveInteger(value.numClasses, DEFAULT_APP_SETTINGS.numClasses);
  const numGroupsPerClass = normalizePositiveInteger(
    value.numGroupsPerClass,
    DEFAULT_APP_SETTINGS.numGroupsPerClass
  );
  const classStart = normalizePositiveInteger(value.classStart, DEFAULT_APP_SETTINGS.classStart);

  return {
    numClasses,
    numGroupsPerClass,
    classStart,
    activeClass: clampActiveClass(value.activeClass, classStart, numClasses),
    agentMode: normalizeAgentMode(value.agentMode),
    agentRole: FIXED_AGENT_ROLE,
    feedbackConditionId: normalizeFeedbackConditionId(value.feedbackConditionId, options),
    sessionPurpose: normalizeSessionPurpose(value.sessionPurpose),
    realtimeResetting: value.realtimeResetting === true,
  };
}

export function mergeSettings(
  current: AppSettings,
  input: Partial<AppSettings> & { agentStance?: unknown },
  options: SettingsNormalizationOptions = {}
): AppSettings {
  const classStart = normalizePositiveInteger(input.classStart, current.classStart);
  const numClasses = normalizePositiveInteger(input.numClasses, current.numClasses);
  const numGroupsPerClass = normalizePositiveInteger(
    input.numGroupsPerClass,
    current.numGroupsPerClass
  );

  return {
    numClasses,
    numGroupsPerClass,
    classStart,
    activeClass:
      input.activeClass === undefined
        ? clampActiveClass(current.activeClass, classStart, numClasses)
        : clampActiveClass(input.activeClass, classStart, numClasses),
    agentMode: normalizeAgentMode(input.agentMode ?? current.agentMode),
    agentRole: FIXED_AGENT_ROLE,
    feedbackConditionId: normalizeFeedbackConditionId(
      input.feedbackConditionId ?? current.feedbackConditionId,
      options
    ),
    sessionPurpose: normalizeSessionPurpose(input.sessionPurpose ?? current.sessionPurpose),
    realtimeResetting:
      typeof input.realtimeResetting === 'boolean'
        ? input.realtimeResetting
        : current.realtimeResetting,
  };
}

function rowToSettings(
  row: AppSettingsRow,
  options: SettingsNormalizationOptions = {}
): AppSettings {
  return normalizeSettings(
    {
      numClasses: row.num_classes as number | undefined,
      numGroupsPerClass: row.num_groups_per_class as number | undefined,
      classStart: row.class_start as number | undefined,
      activeClass: row.active_class as number | undefined,
      agentMode: row.agent_mode as AgentMode | undefined,
      agentRole: row.agent_role as AgentRole | undefined,
      feedbackConditionId: row.feedback_condition_id as string | undefined,
      sessionPurpose: row.session_purpose as SessionPurpose | undefined,
      realtimeResetting: row.realtime_resetting === true,
    },
    options
  );
}

function hasValidSessionPurpose(value: unknown): value is SessionPurpose {
  return value === 'evaluation' || value === 'practice';
}

function settingsToRow(settings: AppSettings, updatedBy?: string | null): AppSettingsRow {
  return {
    id: SETTINGS_ID,
    num_classes: settings.numClasses,
    num_groups_per_class: settings.numGroupsPerClass,
    class_start: settings.classStart,
    active_class: settings.activeClass,
    agent_mode: settings.agentMode,
    agent_role: settings.agentRole,
    feedback_condition_id: settings.feedbackConditionId,
    session_purpose: settings.sessionPurpose,
    realtime_resetting: settings.realtimeResetting,
    updated_by: updatedBy ?? null,
  };
}

function allowsLocalFallback(): boolean {
  return process.env.NODE_ENV !== 'production';
}

async function readLocalSettings(options: SettingsNormalizationOptions = {}): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8')) as Partial<AppSettings> & {
      agentStance?: unknown;
    };
    return normalizeSettings(raw, options);
  } catch {
    return normalizeSettings(DEFAULT_APP_SETTINGS, options);
  }
}

async function writeLocalSettings(settings: AppSettings): Promise<AppSettings> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const tempPath = `${CONFIG_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  await rename(tempPath, CONFIG_PATH);
  return settings;
}

async function readSupabaseSettings(
  options: SettingsNormalizationOptions = {}
): Promise<AppSettings> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', SETTINGS_ID)
    .maybeSingle();

  if (error) {
    throw new SettingsStoreError(
      'settings_read_failed',
      'Supabase app_settings could not be read.'
    );
  }

  if (data) {
    const row = data as AppSettingsRow;
    const settings = rowToSettings(row, options);
    if (allowsLocalFallback() && !hasValidSessionPurpose(row.session_purpose)) {
      const localSettings = await readLocalSettings(options);
      return { ...settings, sessionPurpose: localSettings.sessionPurpose };
    }
    return settings;
  }

  const defaults = normalizeSettings(DEFAULT_APP_SETTINGS, options);
  return upsertSupabaseSettings(defaults, { ...options, updatedBy: null });
}

async function upsertSupabaseSettings(
  settings: AppSettings,
  options: WriteSettingsOptions = {}
): Promise<AppSettings> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('app_settings')
    .upsert(settingsToRow(settings, options.updatedBy), { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    throw new SettingsStoreError(
      'settings_write_failed',
      'Supabase app_settings could not be written.'
    );
  }

  return rowToSettings(
    (data ?? settingsToRow(settings, options.updatedBy)) as AppSettingsRow,
    options
  );
}

function missingSupabaseError() {
  return new SettingsStoreError(
    'supabase_not_configured',
    'Supabase app_settings is not configured.'
  );
}

export async function readSettings(
  options: SettingsNormalizationOptions = {}
): Promise<AppSettings> {
  if (!hasSupabaseAdminEnv()) {
    if (allowsLocalFallback()) {
      return readLocalSettings(options);
    }
    throw missingSupabaseError();
  }

  try {
    return await readSupabaseSettings(options);
  } catch (error) {
    if (allowsLocalFallback()) {
      return readLocalSettings(options);
    }
    throw error;
  }
}

export async function writeSettings(
  input: Partial<AppSettings> & { agentStance?: unknown },
  options: WriteSettingsOptions = {}
): Promise<AppSettings> {
  if (!hasSupabaseAdminEnv()) {
    if (allowsLocalFallback()) {
      const current = await readLocalSettings(options);
      return writeLocalSettings(mergeSettings(current, input, options));
    }
    throw missingSupabaseError();
  }

  try {
    const current = await readSupabaseSettings(options);
    const updated = mergeSettings(current, input, options);
    return await upsertSupabaseSettings(updated, options);
  } catch (error) {
    if (allowsLocalFallback()) {
      const current = await readLocalSettings(options);
      return writeLocalSettings(mergeSettings(current, input, options));
    }
    throw error;
  }
}
