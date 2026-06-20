'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminLogoutButton } from '@/components/admin/admin-logout-button';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { type AgentRole, getAgentRoleLabel, normalizeAgentRole } from '@/lib/agent-role';
import {
  buildLogSessionsQuery,
  filterDashboardSessions,
  getDashboardStudentLabel,
  groupDashboardSessions,
  inferDashboardActivityType,
  inferDashboardSessionPurpose,
} from '@/lib/conversation-dashboard';
import { getActivityTypeLabel, getSessionPurposeLabel } from '@/lib/session-activity';

// ─── 색상 팔레트 ────────────────────────────────────────────────────────────

const PARTICIPANT_PALETTES = [
  { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' },
  { bg: '#dcfce7', text: '#166534', border: '#22c55e' },
  { bg: '#fef9c3', text: '#854d0e', border: '#eab308' },
  { bg: '#fce7f3', text: '#9d174d', border: '#ec4899' },
  { bg: '#ede9fe', text: '#5b21b6', border: '#8b5cf6' },
  { bg: '#ffedd5', text: '#9a3412', border: '#f97316' },
];
const AGENT_PALETTE = { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' };

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface SessionMeta {
  id: string;
  source: 'supabase' | 'file';
  filename?: string;
  room: string;
  session_id: string;
  entry_count: number;
  last_modified: number;
  started_at?: string;
  ended_at?: string | null;
  metadata?: SessionMetadata;
}

interface LogEntry {
  timestamp: string;
  sequence?: number;
  role: 'user' | 'agent';
  text: string;
  participant_identity?: string;
  participant_name?: string;
  student_id?: string;
  student_name?: string;
}

interface SessionMetadata extends Record<string, unknown> {
  activity_type?: string;
  agent_mode?: string;
  agent_role?: AgentRole;
  agent_stance?: AgentRole;
  evaluation_character?: string;
  evaluation_id?: string;
  evaluation_prompt_id?: string;
  evaluation_prompt_version?: string;
  feedback_condition_id?: string;
  task_card_id?: string;
  prompt_id?: string;
  prompt_stack?: unknown;
  prompt_stack_error?: string;
  prompt_source?: string;
  prompt_version_id?: string;
  prompt_saved_at?: string;
  egress_id?: string;
  recording_path?: string;
  session_purpose?: string;
  student_class_number?: string | number;
  student_display_name?: string;
  student_name?: string;
  student_number?: string;
}

interface PromptStackChunk {
  id?: string;
  title?: string;
  content?: string;
}

interface PromptStackMetadata extends Record<string, unknown> {
  schema_version?: number;
  mode?: string;
  source?: string;
  prompt_version_id?: string | null;
  saved_at?: string | null;
  agent_role?: string;
  feedback_condition_id?: string | null;
  feedback_condition_label?: string | null;
  condition_combination_key?: string | null;
  condition_combination_title?: string | null;
  task_card_id?: string | null;
  evaluation_id?: string;
  evaluation_prompt_id?: string;
  evaluation_prompt_version?: string | null;
  evaluation_character?: string;
  participant_name?: string | null;
  stack_order?: string[];
  chunks?: PromptStackChunk[];
  final_prompt?: string;
}

interface LogData {
  id: string;
  source: 'supabase' | 'file';
  session_id: string;
  room: string;
  metadata?: SessionMetadata;
  entries: LogEntry[];
  filename?: string;
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatAgentMode(mode?: string) {
  return mode === 'realtime' ? 'Realtime' : 'Pipeline';
}

function shortId(value?: string) {
  if (!value) return null;
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function promptLabel(metadata?: SessionMetadata) {
  if (!metadata) return null;
  const promptId = metadata.prompt_version_id ?? metadata.prompt_id;
  if (promptId && promptId !== 'default') return `Prompt ${shortId(promptId)}`;
  if (metadata.prompt_source === 'default' || metadata.prompt_id === 'default')
    return 'Default prompt';
  return null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatFeedbackCondition(value: unknown) {
  const id = textValue(value);
  if (id === 'no_corrective') return 'No Feedback';
  if (id === 'explicit_correction') return 'Explicit Correction';
  return id;
}

function formatConditionCombination(value: unknown) {
  const key = textValue(value);
  if (!key) return null;
  if (key === 'dominant_no_feedback') return 'Dominant + No Feedback';
  if (key === 'dominant_no_corrective') return 'Dominant + No Feedback';
  if (key === 'dominant_explicit_correction') return 'Dominant + Explicit Correction';
  if (key === 'collaborative_no_feedback') return 'Collaborative + No Feedback';
  if (key === 'collaborative_no_corrective') return 'Collaborative + No Feedback';
  if (key === 'collaborative_explicit_correction') return 'Collaborative + Explicit Correction';
  return key;
}

function promptStackChunkTitle(chunk: PromptStackChunk, index: number) {
  const id = textValue(chunk.id);
  if (id?.startsWith('condition_combination:')) {
    const combination = formatConditionCombination(id.slice('condition_combination:'.length));
    if (combination) return `Condition Combination Prompt: ${combination}`;
  }
  const title = textValue(chunk.title);
  if (title?.includes('dominant_no_corrective')) {
    return title.replace('dominant_no_corrective', 'dominant_no_feedback');
  }
  if (title?.includes('collaborative_no_corrective')) {
    return title.replace('collaborative_no_corrective', 'collaborative_no_feedback');
  }
  return title ?? id ?? `Chunk ${index + 1}`;
}

function promptStackFromMetadata(metadata?: SessionMetadata): PromptStackMetadata | null {
  const stack = objectValue(metadata?.prompt_stack);
  return stack ? (stack as PromptStackMetadata) : null;
}

function useParticipantColors() {
  const mapRef = useRef<Map<string, (typeof PARTICIPANT_PALETTES)[number]>>(new Map());
  const indexRef = useRef(0);
  return (name: string) => {
    if (!mapRef.current.has(name)) {
      mapRef.current.set(
        name,
        PARTICIPANT_PALETTES[indexRef.current % PARTICIPANT_PALETTES.length]
      );
      indexRef.current += 1;
    }
    return mapRef.current.get(name)!;
  };
}

// ─── 목록 뷰 ─────────────────────────────────────────────────────────────────

function SessionList({ onSelect }: { onSelect: (s: SessionMeta) => void }) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionPurposeFilter, setSessionPurposeFilter] = useState<
    'all' | 'evaluation' | 'practice'
  >('all');
  const [activityTypeFilter, setActivityTypeFilter] = useState<
    'all' | 'free_conversation' | 'task_solution'
  >('all');
  const [evaluationIdFilter, setEvaluationIdFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  const fetchSessions = useCallback(async () => {
    try {
      const query = buildLogSessionsQuery({
        activityType: activityTypeFilter,
        evaluationId: evaluationIdFilter,
        sessionPurpose: sessionPurposeFilter,
      });
      const res = await fetch(`/api/logs${query}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        const message = typeof data.error === 'string' ? data.error : '대화 기록 불러오기 실패';
        throw new Error(message);
      }
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (err) {
      setSessions([]);
      setError(err instanceof Error ? err.message : '대화 기록 불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, [activityTypeFilter, evaluationIdFilter, sessionPurposeFilter]);

  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 5000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  const visibleSessions = filterDashboardSessions(sessions, searchFilter);
  const sessionGroups = groupDashboardSessions(visibleSessions);
  const evaluationOptions = Array.from(
    new Set(
      sessions.flatMap((session) =>
        typeof session.metadata?.evaluation_id === 'string' ? [session.metadata.evaluation_id] : []
      )
    )
  ).sort();

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden">
      <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Session Purpose
          <select
            value={sessionPurposeFilter}
            onChange={(event) =>
              setSessionPurposeFilter(event.target.value as 'all' | 'evaluation' | 'practice')
            }
            className="border-input bg-background rounded-md border px-2 py-1.5 text-xs font-normal"
          >
            <option value="all">All</option>
            <option value="evaluation">Evaluation</option>
            <option value="practice">Practice</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Activity
          <select
            value={activityTypeFilter}
            onChange={(event) =>
              setActivityTypeFilter(
                event.target.value as 'all' | 'free_conversation' | 'task_solution'
              )
            }
            className="border-input bg-background rounded-md border px-2 py-1.5 text-xs font-normal"
          >
            <option value="all">All</option>
            <option value="free_conversation">자유 대화</option>
            <option value="task_solution">과제 해결</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Evaluation ID
          <input
            list="evaluation-id-options"
            value={evaluationIdFilter}
            onChange={(event) => setEvaluationIdFilter(event.target.value)}
            placeholder="all"
            className="border-input bg-background rounded-md border px-2 py-1.5 text-xs font-normal"
          />
          <datalist id="evaluation-id-options">
            {evaluationOptions.map((evaluationId) => (
              <option key={evaluationId} value={evaluationId} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Search
          <input
            value={searchFilter}
            onChange={(event) => setSearchFilter(event.target.value)}
            placeholder="room, student, session"
            className="border-input bg-background rounded-md border px-2 py-1.5 text-xs font-normal"
          />
        </label>
      </div>

      {loading && <p className="text-muted-foreground text-sm">불러오는 중...</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {!loading && !error && sessions.length === 0 && (
        <p className="text-muted-foreground text-sm">저장된 세션이 없습니다.</p>
      )}
      {!loading && !error && sessions.length > 0 && visibleSessions.length === 0 && (
        <p className="text-muted-foreground text-sm">필터에 맞는 세션이 없습니다.</p>
      )}

      {!loading && !error && sessionGroups.length > 0 && (
        <div className="flex flex-1 flex-col gap-8 overflow-y-auto">
          {sessionGroups.map((group) => {
            const totalSessions = group.sections.reduce(
              (count, section) => count + section.sessions.length,
              0
            );
            return (
              <div key={group.key} className="rounded-xl border p-4">
                {/* 목적 헤더 */}
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-foreground text-base font-bold">{group.label}</span>
                  <span className="text-muted-foreground text-xs">{totalSessions}개 세션</span>
                </div>

                {/* metadata 기반 섹션 */}
                <div className="flex flex-col gap-4">
                  {group.sections.map((section) => (
                    <div key={section.key}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span className="bg-muted rounded px-2 py-0.5 font-mono text-xs font-semibold">
                          {section.label}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {section.sessions.length}개
                        </span>
                      </div>
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {section.sessions.map((s) => {
                          const purpose = inferDashboardSessionPurpose(s);
                          const activityType = inferDashboardActivityType(s);
                          return (
                            <li key={s.id}>
                              <button
                                onClick={() => onSelect(s)}
                                className="border-border hover:bg-muted flex h-full w-full flex-col rounded-lg border bg-white p-3 text-left transition-colors dark:bg-neutral-900"
                              >
                                <span className="text-foreground mb-1 block truncate text-sm font-semibold">
                                  {getDashboardStudentLabel(s)}
                                </span>
                                <span className="text-muted-foreground mb-2 block truncate font-mono text-xs">
                                  {s.session_id}
                                </span>
                                <span className="text-muted-foreground mb-2 block truncate font-mono text-[11px]">
                                  {s.source === 'supabase' ? s.id : `file:${s.filename}`}
                                </span>
                                <span className="text-muted-foreground mb-2 flex flex-wrap gap-1 text-xs">
                                  <span>{s.source === 'supabase' ? 'DB' : 'File'}</span>
                                  <span>·</span>
                                  <span>{formatAgentMode(s.metadata?.agent_mode)}</span>
                                  {purpose && <span>· {getSessionPurposeLabel(purpose)}</span>}
                                  {activityType && (
                                    <span>· {getActivityTypeLabel(activityType)}</span>
                                  )}
                                  {s.metadata?.evaluation_id && (
                                    <span>· Eval {s.metadata.evaluation_id}</span>
                                  )}
                                  {s.metadata?.agent_mode === 'realtime' &&
                                    purpose !== 'evaluation' &&
                                    (s.metadata.agent_role || s.metadata.agent_stance) && (
                                      <span>
                                        ·{' '}
                                        {getAgentRoleLabel(
                                          normalizeAgentRole(
                                            s.metadata.agent_role ?? s.metadata.agent_stance
                                          )
                                        )}
                                      </span>
                                    )}
                                  {purpose !== 'evaluation' && promptLabel(s.metadata) && (
                                    <span>· {promptLabel(s.metadata)}</span>
                                  )}
                                  {purpose === 'evaluation' && s.metadata?.evaluation_prompt_id && (
                                    <span>· Prompt {shortId(s.metadata.evaluation_prompt_id)}</span>
                                  )}
                                </span>
                                <span className="text-foreground mt-auto text-sm font-semibold">
                                  대화 {s.entry_count}개
                                </span>
                                <span className="text-muted-foreground mt-1 block text-xs">
                                  {formatDate(s.last_modified)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 대화 뷰 ─────────────────────────────────────────────────────────────────

function PromptStackPanel({
  error,
  expanded,
  onToggle,
  promptStack,
}: {
  error?: string;
  expanded: boolean;
  onToggle: () => void;
  promptStack: PromptStackMetadata | null;
}) {
  const chunks = Array.isArray(promptStack?.chunks)
    ? promptStack.chunks.filter((chunk) => objectValue(chunk))
    : [];
  const detailValues: Array<[string, unknown]> = [
    ['Mode', promptStack?.mode],
    ['Source', promptStack?.source],
    ['Role', promptStack?.agent_role],
    [
      'Feedback',
      promptStack?.feedback_condition_label ??
        formatFeedbackCondition(promptStack?.feedback_condition_id),
    ],
    [
      'Combination',
      promptStack?.condition_combination_title ??
        formatConditionCombination(promptStack?.condition_combination_key),
    ],
    ['Task', promptStack?.task_card_id],
    ['Eval', promptStack?.evaluation_id],
    ['Prompt', promptStack?.evaluation_prompt_id ?? promptStack?.prompt_version_id],
    ['Participant', promptStack?.participant_name],
  ];
  const details = detailValues
    .map(([label, value]) => [label, textValue(value)] as const)
    .filter(([, value]) => value);

  return (
    <div className="mb-3 rounded-lg border bg-white dark:bg-neutral-950">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="border-border hover:bg-muted rounded-md border px-2 py-1 text-xs font-semibold transition-colors"
        >
          {expanded ? 'Hide Prompt Stack' : 'Show Prompt Stack'}
        </button>
        {details.map(([label, value]) => (
          <span key={label} className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {label}: {value}
          </span>
        ))}
        {error && (
          <span className="text-destructive rounded bg-red-50 px-2 py-0.5 text-xs font-semibold dark:bg-red-950/40">
            Error
          </span>
        )}
      </div>
      {expanded && (
        <div className="space-y-3 p-3">
          {error && (
            <pre className="text-destructive max-h-40 overflow-auto rounded-md bg-red-50 p-3 font-mono text-xs break-words whitespace-pre-wrap dark:bg-red-950/40">
              {error}
            </pre>
          )}
          {chunks.map((chunk, index) => {
            const title = promptStackChunkTitle(chunk, index);
            const content = textValue(chunk.content) ?? '';
            return (
              <details key={chunk.id ?? `${title}-${index}`} open={index === 0}>
                <summary className="cursor-pointer text-xs font-semibold">{title}</summary>
                <pre className="bg-muted/50 mt-2 max-h-72 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                  {content}
                </pre>
              </details>
            );
          })}
          {promptStack?.final_prompt && (
            <details open>
              <summary className="cursor-pointer text-xs font-semibold">Final Prompt</summary>
              <pre className="bg-muted/50 mt-2 max-h-96 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                {promptStack.final_prompt}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ConversationView({ session, onBack }: { session: SessionMeta; onBack: () => void }) {
  const [log, setLog] = useState<LogData | null>(null);
  const [connected, setConnected] = useState(false);
  const [showPromptStack, setShowPromptStack] = useState(false);
  const getColor = useParticipantColors();

  useEffect(() => {
    const params = new URLSearchParams();
    if (session.source === 'file' && session.filename) {
      params.set('filename', session.filename);
    } else {
      params.set('sessionId', session.id);
    }
    const es = new EventSource(`/api/logs/stream?${params.toString()}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        setLog(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [session.filename, session.id, session.source]);

  useEffect(() => {
    setShowPromptStack(false);
  }, [session.filename, session.id]);

  const metadata = log?.metadata ?? session.metadata;
  const promptStack = promptStackFromMetadata(metadata);
  const promptStackError = metadata?.prompt_stack_error;
  const role = metadata?.agent_role ?? metadata?.agent_stance;
  const purpose = inferDashboardSessionPurpose({ metadata, room: session.room });
  const activityType = inferDashboardActivityType({ metadata, room: session.room });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← 목록
        </button>
        <div className="bg-border h-4 w-px" />
        <span className="bg-muted rounded px-2 py-0.5 font-mono text-xs font-semibold">
          {session.room}
        </span>
        <span className="text-muted-foreground font-mono text-xs">{session.session_id}</span>
        <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
          {formatAgentMode(metadata?.agent_mode)}
        </span>
        {purpose && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {getSessionPurposeLabel(purpose)}
          </span>
        )}
        {activityType && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {getActivityTypeLabel(activityType)}
          </span>
        )}
        {metadata?.agent_mode === 'realtime' && purpose !== 'evaluation' && role && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {getAgentRoleLabel(normalizeAgentRole(role))} 에이전트
          </span>
        )}
        {purpose !== 'evaluation' && metadata?.feedback_condition_id && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {formatFeedbackCondition(metadata.feedback_condition_id)}
          </span>
        )}
        {purpose !== 'evaluation' && promptLabel(metadata) && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {promptLabel(metadata)}
          </span>
        )}
        {purpose === 'evaluation' && metadata?.evaluation_id && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            Eval {metadata.evaluation_id}
          </span>
        )}
        {purpose === 'evaluation' && metadata?.evaluation_prompt_id && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            Prompt {shortId(metadata.evaluation_prompt_id)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          <span
            className={`inline-block size-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`}
          />
          {connected ? '연결됨' : '연결 끊김'}
        </span>
      </div>
      {(promptStack || promptStackError) && (
        <PromptStackPanel
          error={promptStackError}
          expanded={showPromptStack}
          onToggle={() => setShowPromptStack((value) => !value)}
          promptStack={promptStack}
        />
      )}
      <div className="flex flex-1 overflow-hidden rounded-lg border">
        <Conversation className="flex-1">
          <ConversationContent className="gap-3">
            {!log || log.entries.length === 0 ? (
              <ConversationEmptyState
                title="대화 없음"
                description="이 세션의 대화 내역이 없습니다."
              />
            ) : (
              log.entries.map((entry, i) => {
                const isAgent = entry.role === 'agent';
                const speakerName = isAgent
                  ? '에이전트'
                  : (entry.student_name ??
                    entry.participant_name ??
                    entry.participant_identity ??
                    '참가자');
                const palette = isAgent ? AGENT_PALETTE : getColor(speakerName);
                return (
                  <div
                    key={entry.sequence ?? `${entry.timestamp}-${i}`}
                    className={`flex items-start gap-3 px-2 py-1 ${isAgent ? 'flex-row' : 'flex-row-reverse'}`}
                  >
                    <div
                      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{ backgroundColor: palette.border, color: '#fff' }}
                    >
                      {isAgent ? 'AI' : getInitials(speakerName)}
                    </div>
                    <div
                      className={`max-w-[75%] rounded-md px-3 py-2 text-sm ${isAgent ? 'border-l-4' : 'border-r-4'}`}
                      style={{
                        borderColor: palette.border,
                        backgroundColor: palette.bg,
                        color: palette.text,
                      }}
                    >
                      <span
                        className={`mb-1 block text-xs font-semibold ${isAgent ? 'text-left' : 'text-right'}`}
                      >
                        {speakerName}
                      </span>
                      <span>{entry.text}</span>
                      <span
                        className={`mt-1 block text-xs opacity-60 ${isAgent ? 'text-left' : 'text-right'}`}
                      >
                        {new Date(entry.timestamp).toLocaleTimeString('ko-KR')}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [selected, setSelected] = useState<SessionMeta | null>(null);

  return (
    <div className="flex h-screen flex-col px-6 pt-20 pb-6">
      <div className="mb-4 grid grid-cols-3 items-center">
        <a
          href="/admin"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← 관리자 설정
        </a>
        <h1 className="text-center text-lg font-semibold">
          {selected ? '대화 기록' : '세션 목록'}
        </h1>
        <div className="flex justify-end">
          <AdminLogoutButton />
        </div>
      </div>
      {selected ? (
        <ConversationView session={selected} onBack={() => setSelected(null)} />
      ) : (
        <SessionList onSelect={setSelected} />
      )}
    </div>
  );
}
