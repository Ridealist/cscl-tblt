'use client';

import { useEffect, useRef, useState } from 'react';
import { AdminLogoutButton } from '@/components/admin/admin-logout-button';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { type AgentRole, getAgentRoleLabel, normalizeAgentRole } from '@/lib/agent-role';

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
}

interface SessionMetadata {
  agent_mode?: string;
  agent_role?: AgentRole;
  agent_stance?: AgentRole;
  feedback_condition_id?: string;
  task_card_id?: string;
  prompt_id?: string;
  prompt_source?: string;
  prompt_version_id?: string;
  prompt_saved_at?: string;
  egress_id?: string;
  recording_path?: string;
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

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/logs', { cache: 'no-store' });
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
  };

  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 5000);
    return () => clearInterval(id);
  }, []);

  // "9반-1그룹" → { class: "9반", group: "1그룹" }
  const parseRoom = (room: string) => {
    const idx = room.lastIndexOf('-');
    return idx !== -1
      ? { cls: room.slice(0, idx), grp: room.slice(idx + 1) }
      : { cls: room, grp: '' };
  };

  // 반 → 그룹 → 세션 2단 구조로 그룹화
  const byClass: Record<string, Record<string, SessionMeta[]>> = {};
  for (const s of sessions) {
    const { cls, grp } = parseRoom(s.room);
    ((byClass[cls] ??= {})[grp] ??= []).push(s);
  }

  // 반 번호 기준 정렬 (숫자 추출)
  const sortedClasses = Object.keys(byClass).sort((a, b) => parseInt(a) - parseInt(b));

  if (loading) return <p className="text-muted-foreground text-sm">불러오는 중...</p>;
  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (sessions.length === 0)
    return <p className="text-muted-foreground text-sm">저장된 세션이 없습니다.</p>;

  return (
    <div className="flex flex-1 flex-col gap-8 overflow-y-auto">
      {sortedClasses.map((cls) => {
        const groups = byClass[cls];
        const sortedGroups = Object.keys(groups).sort((a, b) => parseInt(a) - parseInt(b));
        const totalSessions = sortedGroups.reduce((n, g) => n + groups[g].length, 0);

        return (
          <div key={cls} className="rounded-xl border p-4">
            {/* 반 헤더 */}
            <div className="mb-4 flex items-center gap-2">
              <span className="text-foreground text-base font-bold">{cls}</span>
              <span className="text-muted-foreground text-xs">{totalSessions}개 세션</span>
            </div>

            {/* 그룹별 세션 */}
            <div className="flex flex-col gap-4">
              {sortedGroups.map((grp) => (
                <div key={grp}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="bg-muted rounded px-2 py-0.5 font-mono text-xs font-semibold">
                      {grp}
                    </span>
                    <span className="text-muted-foreground text-xs">{groups[grp].length}개</span>
                  </div>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {groups[grp].map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => onSelect(s)}
                          className="border-border hover:bg-muted flex h-full w-full flex-col rounded-lg border bg-white p-3 text-left transition-colors dark:bg-neutral-900"
                        >
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
                            {s.metadata?.agent_mode === 'realtime' &&
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
                            {promptLabel(s.metadata) && <span>· {promptLabel(s.metadata)}</span>}
                          </span>
                          <span className="text-foreground mt-auto text-sm font-semibold">
                            대화 {s.entry_count}개
                          </span>
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {formatDate(s.last_modified)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 대화 뷰 ─────────────────────────────────────────────────────────────────

function ConversationView({ session, onBack }: { session: SessionMeta; onBack: () => void }) {
  const [log, setLog] = useState<LogData | null>(null);
  const [connected, setConnected] = useState(false);
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

  const metadata = log?.metadata ?? session.metadata;
  const role = metadata?.agent_role ?? metadata?.agent_stance;

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
        {metadata?.agent_mode === 'realtime' && role && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {getAgentRoleLabel(normalizeAgentRole(role))} 에이전트
          </span>
        )}
        {metadata?.feedback_condition_id && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {metadata.feedback_condition_id}
          </span>
        )}
        {promptLabel(metadata) && (
          <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
            {promptLabel(metadata)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          <span
            className={`inline-block size-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`}
          />
          {connected ? '연결됨' : '연결 끊김'}
        </span>
      </div>
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
                  : (entry.participant_name ?? entry.participant_identity ?? '참가자');
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
