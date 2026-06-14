import { readFileSync, readdirSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import 'server-only';
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from '@/lib/supabase/admin';

const LOGS_DIR = resolve(process.cwd(), '..', 'logs');
const DEFAULT_SESSION_LIMIT = 200;
const EVENT_PAGE_SIZE = 1000;
const SESSION_COLUMNS = [
  'id',
  'livekit_session_id',
  'room_name',
  'agent_mode',
  'agent_role',
  'session_purpose',
  'activity_type',
  'evaluation_id',
  'evaluation_prompt_id',
  'evaluation_prompt_version',
  'feedback_condition_id',
  'task_card_id',
  'prompt_version_id',
  'egress_id',
  'recording_path',
  'metadata',
  'started_at',
  'ended_at',
].join(',');
const EVENT_COLUMNS = [
  'session_id',
  'sequence',
  'role',
  'text',
  'participant_identity',
  'participant_name',
  'metadata',
  'created_at',
].join(',');

type LogSource = 'supabase' | 'file';

type SupabaseSessionRow = {
  id?: unknown;
  livekit_session_id?: unknown;
  room_name?: unknown;
  agent_mode?: unknown;
  agent_role?: unknown;
  activity_type?: unknown;
  evaluation_id?: unknown;
  evaluation_prompt_id?: unknown;
  evaluation_prompt_version?: unknown;
  feedback_condition_id?: unknown;
  task_card_id?: unknown;
  prompt_version_id?: unknown;
  egress_id?: unknown;
  recording_path?: unknown;
  session_purpose?: unknown;
  metadata?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
};

type SupabaseEventRow = {
  session_id?: unknown;
  sequence?: unknown;
  role?: unknown;
  text?: unknown;
  participant_identity?: unknown;
  participant_name?: unknown;
  metadata?: unknown;
  created_at?: unknown;
};

type SupabasePagedQuery<T> = {
  range: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: T[] | null;
    error: unknown;
  }>;
};

export type ConversationLogMetadata = Record<string, unknown>;

export interface ConversationLogSession {
  id: string;
  source: LogSource;
  filename?: string;
  room: string;
  session_id: string;
  entry_count: number;
  last_modified: number;
  started_at?: string;
  ended_at?: string | null;
  metadata?: ConversationLogMetadata;
}

export interface ConversationLogEntry {
  timestamp: string;
  sequence?: number;
  role: 'user' | 'agent';
  text: string;
  participant_identity?: string;
  participant_name?: string;
  metadata?: ConversationLogMetadata;
}

export interface ConversationLogData {
  id: string;
  source: LogSource;
  filename?: string;
  session_id: string;
  room: string;
  metadata?: ConversationLogMetadata;
  entries: ConversationLogEntry[];
}

export interface ConversationLogSessionFilters {
  agentMode?: string;
  agentRole?: string;
  activityType?: string;
  evaluationId?: string;
  feedbackConditionId?: string;
  promptVersionId?: string;
  room?: string;
  sessionPurpose?: string;
  limit?: number;
}

export class ConversationLogStoreError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ConversationLogStoreError';
    this.status = status;
    this.code = code;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function timestampMs(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

function objectValue(value: unknown): ConversationLogMetadata {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as ConversationLogMetadata) }
    : {};
}

function shouldUseFileFallback(): boolean {
  const raw = process.env.CONVERSATION_LOG_FILE_FALLBACK?.trim().toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

function missingSupabaseError() {
  return new ConversationLogStoreError(
    503,
    'supabase_not_configured',
    'Supabase conversation logs are not configured.'
  );
}

function supabaseReadError(operation: string) {
  return new ConversationLogStoreError(
    500,
    'supabase_read_failed',
    `Supabase conversation logs could not be read: ${operation}.`
  );
}

function invalidFileLogFilenameError() {
  return new ConversationLogStoreError(400, 'invalid_filename', 'Invalid file log filename.');
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SESSION_LIMIT;
  return Math.min(Math.max(Math.trunc(value as number), 1), 500);
}

export function parseConversationLogSessionFilters(
  searchParams: URLSearchParams
): ConversationLogSessionFilters {
  const limit = Number(searchParams.get('limit'));
  return {
    agentMode: text(searchParams.get('agentMode')),
    agentRole: text(searchParams.get('agentRole')),
    activityType: text(searchParams.get('activityType')),
    evaluationId: text(searchParams.get('evaluationId')),
    feedbackConditionId: text(searchParams.get('feedbackConditionId')),
    promptVersionId: text(searchParams.get('promptVersionId')),
    room: text(searchParams.get('room')),
    sessionPurpose: text(searchParams.get('sessionPurpose')),
    limit: Number.isFinite(limit) ? limit : undefined,
  };
}

function sessionMetadata(row: SupabaseSessionRow): ConversationLogMetadata {
  const metadata = objectValue(row.metadata);
  const values: ConversationLogMetadata = {
    agent_mode: text(row.agent_mode),
    agent_role: text(row.agent_role),
    activity_type: text(row.activity_type),
    evaluation_id: text(row.evaluation_id),
    evaluation_prompt_id: text(row.evaluation_prompt_id),
    evaluation_prompt_version: text(row.evaluation_prompt_version),
    feedback_condition_id: text(row.feedback_condition_id),
    task_card_id: text(row.task_card_id),
    prompt_version_id: text(row.prompt_version_id),
    egress_id: text(row.egress_id),
    recording_path: text(row.recording_path),
    session_purpose: text(row.session_purpose),
  };

  Object.entries(values).forEach(([key, value]) => {
    if (value) metadata[key] = value;
  });
  return metadata;
}

function mapSessionRow(
  row: SupabaseSessionRow,
  eventsBySessionId: Map<string, SupabaseEventRow[]>
): ConversationLogSession | null {
  const id = text(row.id);
  const livekitSessionId = text(row.livekit_session_id);
  const room = text(row.room_name);
  if (!id || !livekitSessionId || !room) return null;

  const events = eventsBySessionId.get(id) ?? [];
  const startedAt = text(row.started_at);
  const endedAt = text(row.ended_at) ?? null;
  const lastEventMs = events.reduce((latest, event) => {
    return Math.max(latest, timestampMs(event.created_at) ?? 0);
  }, 0);
  const lastModified =
    Math.max(timestampMs(row.ended_at) ?? 0, lastEventMs, timestampMs(row.started_at) ?? 0) ||
    Date.now();

  return {
    id,
    source: 'supabase',
    room,
    session_id: livekitSessionId,
    entry_count: events.length,
    last_modified: lastModified,
    started_at: startedAt,
    ended_at: endedAt,
    metadata: sessionMetadata(row),
  };
}

function mapEventRow(row: SupabaseEventRow): ConversationLogEntry | null {
  const role = text(row.role);
  const eventText = text(row.text);
  const timestamp = text(row.created_at);
  if ((role !== 'user' && role !== 'agent') || !eventText || !timestamp) return null;

  const sequence = typeof row.sequence === 'number' ? row.sequence : Number(row.sequence);
  return {
    timestamp,
    ...(Number.isFinite(sequence) ? { sequence } : {}),
    role,
    text: eventText,
    ...(text(row.participant_identity)
      ? { participant_identity: text(row.participant_identity) }
      : {}),
    ...(text(row.participant_name) ? { participant_name: text(row.participant_name) } : {}),
    metadata: objectValue(row.metadata),
  };
}

function eventsBySessionId(rows: SupabaseEventRow[]) {
  const grouped = new Map<string, SupabaseEventRow[]>();
  rows.forEach((row) => {
    const sessionId = text(row.session_id);
    if (!sessionId) return;
    const events = grouped.get(sessionId) ?? [];
    events.push(row);
    grouped.set(sessionId, events);
  });
  return grouped;
}

async function readPagedSupabaseRows<T>(
  createQuery: () => SupabasePagedQuery<T>,
  operation: string
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += EVENT_PAGE_SIZE) {
    const to = from + EVENT_PAGE_SIZE - 1;
    const { data, error } = await createQuery().range(from, to);
    if (error) throw supabaseReadError(operation);

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < EVENT_PAGE_SIZE) return rows;
  }
}

async function readSupabaseSessions(
  filters: ConversationLogSessionFilters
): Promise<ConversationLogSession[]> {
  const supabase = createSupabaseAdminClient();
  const limit = normalizeLimit(filters.limit);
  let query = supabase
    .from('class_sessions')
    .select(SESSION_COLUMNS)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (filters.agentMode) query = query.eq('agent_mode', filters.agentMode);
  if (filters.agentRole) query = query.eq('agent_role', filters.agentRole);
  if (filters.activityType) query = query.eq('activity_type', filters.activityType);
  if (filters.evaluationId) query = query.eq('evaluation_id', filters.evaluationId);
  if (filters.feedbackConditionId) {
    query = query.eq('feedback_condition_id', filters.feedbackConditionId);
  }
  if (filters.promptVersionId) query = query.eq('prompt_version_id', filters.promptVersionId);
  if (filters.room) query = query.eq('room_name', filters.room);
  if (filters.sessionPurpose) query = query.eq('session_purpose', filters.sessionPurpose);

  const { data: sessionRows, error: sessionError } = await query;
  if (sessionError) throw supabaseReadError('class_sessions');

  const sessions = Array.isArray(sessionRows) ? (sessionRows as SupabaseSessionRow[]) : [];
  if (sessions.length === 0) return [];

  const sessionIds = sessions.flatMap((session) => {
    const id = text(session.id);
    return id ? [id] : [];
  });
  const eventRows = await readPagedSupabaseRows<SupabaseEventRow>(
    () =>
      supabase
        .from('conversation_events')
        .select('session_id,created_at')
        .in('session_id', sessionIds),
    'conversation_events'
  );
  const groupedEvents = eventsBySessionId(eventRows);
  return sessions.flatMap((row) => {
    const session = mapSessionRow(row, groupedEvents);
    return session ? [session] : [];
  });
}

async function readSupabaseLogData(sessionId: string): Promise<ConversationLogData> {
  const supabase = createSupabaseAdminClient();
  const { data: sessionRow, error: sessionError } = await supabase
    .from('class_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) throw supabaseReadError('class_sessions');
  if (!sessionRow) {
    throw new ConversationLogStoreError(
      404,
      'session_not_found',
      'Conversation session not found.'
    );
  }

  const eventRows = await readPagedSupabaseRows<SupabaseEventRow>(
    () =>
      supabase
        .from('conversation_events')
        .select(EVENT_COLUMNS)
        .eq('session_id', sessionId)
        .order('sequence', { ascending: true })
        .order('created_at', {
          ascending: true,
        }) as unknown as SupabasePagedQuery<SupabaseEventRow>,
    'conversation_events'
  );

  const mappedSession = mapSessionRow(
    sessionRow as SupabaseSessionRow,
    eventsBySessionId(eventRows)
  );
  if (!mappedSession) {
    throw new ConversationLogStoreError(
      404,
      'session_not_found',
      'Conversation session not found.'
    );
  }

  return {
    id: mappedSession.id,
    source: 'supabase',
    session_id: mappedSession.session_id,
    room: mappedSession.room,
    metadata: mappedSession.metadata,
    entries: eventRows.flatMap((row) => {
      const entry = mapEventRow(row);
      return entry ? [entry] : [];
    }),
  };
}

function fileLogPath(filename?: string | null): { filename: string; path: string } {
  const targetFilename =
    filename && filename.startsWith('file:') ? filename.slice('file:'.length) : filename;
  const normalized = text(targetFilename);
  if (!normalized) {
    throw new ConversationLogStoreError(400, 'filename_required', 'filename is required.');
  }
  if (
    isAbsolute(normalized) ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    !normalized.endsWith('.json')
  ) {
    throw invalidFileLogFilenameError();
  }

  const resolvedPath = resolve(LOGS_DIR, normalized);
  const relativePath = relative(LOGS_DIR, resolvedPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw invalidFileLogFilenameError();
  }

  return { filename: normalized, path: resolvedPath };
}

function readFileLogSessions(
  filters: ConversationLogSessionFilters = {}
): ConversationLogSession[] {
  try {
    return readdirSync(LOGS_DIR)
      .filter((file) => file.endsWith('.json'))
      .flatMap((filename) => {
        const path = join(LOGS_DIR, filename);
        try {
          const stat = statSync(path);
          const data = JSON.parse(readFileSync(path, 'utf-8')) as {
            room?: unknown;
            session_id?: unknown;
            metadata?: unknown;
            entries?: unknown;
          };
          const metadata = objectValue(data.metadata);
          if (filters.agentMode && metadata.agent_mode !== filters.agentMode) return [];
          if (filters.agentRole && metadata.agent_role !== filters.agentRole) return [];
          if (filters.activityType && metadata.activity_type !== filters.activityType) return [];
          if (filters.evaluationId && metadata.evaluation_id !== filters.evaluationId) return [];
          if (
            filters.feedbackConditionId &&
            metadata.feedback_condition_id !== filters.feedbackConditionId
          ) {
            return [];
          }
          if (filters.promptVersionId && metadata.prompt_version_id !== filters.promptVersionId) {
            return [];
          }
          const room = text(data.room) ?? '—';
          if (filters.room && room !== filters.room) return [];
          if (filters.sessionPurpose && metadata.session_purpose !== filters.sessionPurpose) {
            return [];
          }
          return [
            {
              id: `file:${filename}`,
              source: 'file' as const,
              filename,
              room,
              session_id: text(data.session_id) ?? '—',
              entry_count: Array.isArray(data.entries) ? data.entries.length : 0,
              last_modified: stat.mtimeMs,
              metadata,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.last_modified - a.last_modified)
      .slice(0, normalizeLimit(filters.limit));
  } catch {
    return [];
  }
}

function readFileLogData(filename?: string | null): ConversationLogData {
  const target = fileLogPath(filename);

  try {
    const data = JSON.parse(readFileSync(target.path, 'utf-8')) as {
      room?: unknown;
      session_id?: unknown;
      metadata?: unknown;
      entries?: unknown;
    };
    return {
      id: `file:${target.filename}`,
      source: 'file',
      filename: target.filename,
      session_id: text(data.session_id) ?? '—',
      room: text(data.room) ?? '—',
      metadata: objectValue(data.metadata),
      entries: Array.isArray(data.entries)
        ? data.entries.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const raw = entry as Record<string, unknown>;
            const role = text(raw.role);
            const entryText = text(raw.text);
            const timestamp = text(raw.timestamp);
            if ((role !== 'user' && role !== 'agent') || !entryText || !timestamp) return [];
            return [
              {
                timestamp,
                sequence: typeof raw.sequence === 'number' ? raw.sequence : undefined,
                role,
                text: entryText,
                ...(text(raw.participant_identity)
                  ? { participant_identity: text(raw.participant_identity) }
                  : {}),
                ...(text(raw.participant_name)
                  ? { participant_name: text(raw.participant_name) }
                  : {}),
              },
            ];
          })
        : [],
    };
  } catch {
    throw new ConversationLogStoreError(404, 'file_log_not_found', 'File log not found.');
  }
}

function fallbackSessionsOrThrow(
  error: ConversationLogStoreError,
  filters: ConversationLogSessionFilters
) {
  if (error.code === 'supabase_not_configured' && shouldUseFileFallback()) {
    return readFileLogSessions(filters);
  }
  throw error;
}

export async function readConversationLogSessions(
  filters: ConversationLogSessionFilters = {}
): Promise<ConversationLogSession[]> {
  if (!hasSupabaseAdminEnv()) {
    return fallbackSessionsOrThrow(missingSupabaseError(), filters);
  }

  try {
    return await readSupabaseSessions(filters);
  } catch (error) {
    if (error instanceof ConversationLogStoreError) {
      return fallbackSessionsOrThrow(error, filters);
    }
    return fallbackSessionsOrThrow(supabaseReadError('unknown'), filters);
  }
}

export async function readConversationLogData({
  filename,
  sessionId,
}: {
  filename?: string | null;
  sessionId?: string | null;
}): Promise<ConversationLogData> {
  const normalizedSessionId = text(sessionId);
  const normalizedFilename = text(filename);

  if (normalizedSessionId && !normalizedSessionId.startsWith('file:')) {
    if (!hasSupabaseAdminEnv()) {
      throw missingSupabaseError();
    }
    return readSupabaseLogData(normalizedSessionId);
  }

  if (normalizedSessionId?.startsWith('file:') || normalizedFilename) {
    if (!shouldUseFileFallback()) {
      throw new ConversationLogStoreError(
        400,
        'file_fallback_disabled',
        'File log fallback is disabled.'
      );
    }
    return readFileLogData(normalizedSessionId ?? normalizedFilename);
  }

  throw new ConversationLogStoreError(
    400,
    'session_id_required',
    'sessionId is required for Supabase conversation log streams.'
  );
}
