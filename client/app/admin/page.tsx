'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminLogoutButton } from '@/components/admin/admin-logout-button';
import { PromptEditorView } from '@/components/admin/prompt-editor-view';
import { type AgentMode, getAgentModeLabel } from '@/lib/agent-mode';
import { type AgentRole, getAgentRoleLabel } from '@/lib/agent-role';
import type { RealtimePromptSource } from '@/lib/realtime-prompt-config';

type AdminTab = 'settings' | 'prompts';

const ADMIN_TABS: { value: AdminTab; label: string }[] = [
  { value: 'settings', label: '운영 설정' },
  { value: 'prompts', label: '프롬프트 편집' },
];

const REALTIME_TERMINATION_TIMEOUT_MS = 20_000;
const REALTIME_TERMINATION_POLL_MS = 750;

interface Settings {
  numClasses: number;
  numGroupsPerClass: number;
  classStart: number;
  activeClass: number;
  agentMode: AgentMode;
  agentRole: AgentRole;
  feedbackConditionId: string;
  realtimeResetting: boolean;
}

interface FeedbackConditionOption {
  id: string;
  title: string;
}

type SettingsResponse = Settings & {
  feedbackConditions?: FeedbackConditionOption[];
};

// ─── 룸 관리 섹션 ─────────────────────────────────────────────────────────────

interface RoomStatus {
  room: string;
  numParticipants: number | null; // null = 로딩 중
  hasAgent: boolean | null; // null = 로딩 중
}

function AgentDispatchSection({
  activeClass,
  numGroupsPerClass,
}: {
  activeClass: number;
  numGroupsPerClass: number;
}) {
  const [statuses, setStatuses] = useState<RoomStatus[]>([]);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [terminating, setTerminating] = useState<string | null>(null);
  const [message, setMessage] = useState<{ room: string; text: string; ok: boolean } | null>(null);

  const roomNames = Array.from(
    { length: numGroupsPerClass },
    (_, i) => `${activeClass}반-${i + 1}그룹`
  );

  const fetchStatuses = useCallback(async () => {
    setStatuses(roomNames.map((room) => ({ room, numParticipants: null, hasAgent: null })));

    // 참가자 수와 에이전트 상태를 병렬로 조회
    const [roomsRes, ...agentResults] = await Promise.all([
      fetch('/api/rooms')
        .then((r) => r.json())
        .catch(() => ({ rooms: [] })),
      ...roomNames.map((room) =>
        fetch(`/api/dispatch?room=${encodeURIComponent(room)}`)
          .then((r) => r.json())
          .catch(() => ({ hasAgent: false }))
      ),
    ]);

    const participantMap = new Map<string, number>(
      (roomsRes.rooms ?? []).map((r: { name: string; numParticipants: number }) => [
        r.name,
        r.numParticipants,
      ])
    );

    setStatuses(
      roomNames.map((room, i) => ({
        room,
        numParticipants: participantMap.get(room) ?? 0,
        hasAgent: (agentResults[i] as { hasAgent: boolean }).hasAgent,
      }))
    );
  }, [activeClass, numGroupsPerClass]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  async function handleDispatch(room: string) {
    setDispatching(room);
    setMessage(null);
    try {
      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ room, text: '에이전트 배치 요청을 전송했습니다.', ok: true });
        await fetchStatuses();
      } else {
        setMessage({ room, text: data.error ?? '배치 실패', ok: false });
      }
    } catch {
      setMessage({ room, text: '요청 중 오류가 발생했습니다.', ok: false });
    } finally {
      setDispatching(null);
    }
  }

  async function handleTerminate(room: string) {
    if (!window.confirm(`[${room}] 방의 모든 참가자가 퇴장됩니다.\n세션을 종료하시겠습니까?`))
      return;
    setTerminating(room);
    setMessage(null);
    try {
      const res = await fetch('/api/rooms/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ room, text: '세션이 종료되었습니다.', ok: true });
        await fetchStatuses();
      } else {
        setMessage({ room, text: data.error ?? '세션 종료 실패', ok: false });
      }
    } catch {
      setMessage({ room, text: '요청 중 오류가 발생했습니다.', ok: false });
    } finally {
      setTerminating(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-sm font-semibold">룸 현황 및 관리</h2>
          <p className="text-muted-foreground text-xs">
            에이전트 수동 배치 및 세션 종료를 제어합니다.
          </p>
        </div>
        <button
          onClick={fetchStatuses}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors"
        >
          새로고침
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {statuses.map(({ room, numParticipants, hasAgent }) => {
          const loading = numParticipants === null || hasAgent === null;
          const isActive = (numParticipants ?? 0) > 0;
          return (
            <div
              key={room}
              className="border-border flex items-center justify-between rounded-lg border px-4 py-2.5"
            >
              {/* 방 이름 + 상태 뱃지 */}
              <div className="flex items-center gap-2">
                <span className="text-foreground text-sm font-medium">{room}</span>
                {loading ? (
                  <span className="text-muted-foreground text-xs">확인 중...</span>
                ) : (
                  <>
                    {isActive && (
                      <span className="text-muted-foreground text-xs">{numParticipants}명</span>
                    )}
                    {hasAgent ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <span className="size-1.5 rounded-full bg-green-500" />
                        에이전트 활성
                      </span>
                    ) : (
                      <span className="text-muted-foreground inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium">
                        <span className="size-1.5 rounded-full bg-gray-400" />
                        에이전트 없음
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* 액션 버튼 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDispatch(room)}
                  disabled={hasAgent !== false || dispatching === room}
                  className="rounded-md border px-3 py-1 text-xs font-semibold transition-colors enabled:border-blue-500 enabled:text-blue-600 enabled:hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {dispatching === room ? '배치 중...' : '수동 배치'}
                </button>
                <button
                  onClick={() => handleTerminate(room)}
                  disabled={!isActive || terminating === room}
                  className="rounded-md border px-3 py-1 text-xs font-semibold transition-colors enabled:border-red-400 enabled:text-red-500 enabled:hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {terminating === room ? '종료 중...' : '세션 종료'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-destructive'}`}>
          [{message.room}] {message.text}
        </p>
      )}
    </section>
  );
}

interface RealtimeRoomStatus {
  name: string;
  agentRole?: AgentRole;
  feedbackConditionId?: string;
  promptId?: string;
  promptVersionId?: string;
  promptSavedAt?: string | null;
  promptSource?: RealtimePromptSource;
  numParticipants: number;
  totalParticipants?: number;
  numAgents?: number;
  numEgress?: number;
}

type RealtimeRoomsResponse = {
  realtimeRooms?: Array<{ name: string }>;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getFeedbackConditionDescription(id: string) {
  if (id === 'no_corrective') return '학생 오류를 명시적으로 고치지 않고 의미를 받아 진행';
  if (id === 'explicit_correction') return 'Step 1 Information Gap에서만 1회 명시적 교정';
  return 'Realtime feedback condition';
}

function RealtimeSessionSection({
  feedbackConditions,
}: {
  feedbackConditions: FeedbackConditionOption[];
}) {
  const [rooms, setRooms] = useState<RealtimeRoomStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [terminating, setTerminating] = useState<string | null>(null);
  const [message, setMessage] = useState<{ room: string; text: string; ok: boolean } | null>(null);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rooms', { cache: 'no-store' });
      const data = await res.json();
      setRooms(data.realtimeRooms ?? []);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  async function handleTerminate(room: string) {
    if (!window.confirm(`[${room}] 개별 세션을 종료하시겠습니까?`)) return;
    setTerminating(room);
    setMessage(null);
    try {
      const res = await fetch('/api/rooms/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ room, text: '세션이 종료되었습니다.', ok: true });
        await fetchRooms();
      } else {
        setMessage({ room, text: data.error ?? '세션 종료 실패', ok: false });
      }
    } catch {
      setMessage({ room, text: '요청 중 오류가 발생했습니다.', ok: false });
    } finally {
      setTerminating(null);
    }
  }

  function formatPromptApplied(room: RealtimeRoomStatus) {
    if (!room.promptSource) return '미기록';
    if (room.promptSource === 'default') return '기본 프롬프트';
    const savedAt = room.promptSavedAt
      ? new Date(room.promptSavedAt).toLocaleString('ko-KR')
      : '저장 시각 미기록';
    return `수정 프롬프트 · ${room.promptId ?? 'ID 미기록'} · ${savedAt}`;
  }

  function formatFeedbackCondition(room: RealtimeRoomStatus) {
    if (!room.feedbackConditionId) return '미기록';
    return (
      feedbackConditions.find((condition) => condition.id === room.feedbackConditionId)?.title ??
      room.feedbackConditionId
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-sm font-semibold">개별 세션 현황</h2>
          <p className="text-muted-foreground text-xs">
            Realtime 모드의 학생별 1:1 방을 표시합니다.
          </p>
        </div>
        <button
          onClick={fetchRooms}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors"
        >
          새로고침
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {loading && <p className="text-muted-foreground text-xs">확인 중...</p>}
        {!loading && rooms.length === 0 && (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-xs">
            진행 중인 개별 세션이 없습니다.
          </p>
        )}
        {rooms.map((room) => (
          <div
            key={room.name}
            className="border-border flex items-center justify-between rounded-lg border px-4 py-2.5"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-foreground truncate text-sm font-medium">{room.name}</span>
              <span className="text-muted-foreground text-xs">
                적용 프롬프트:{' '}
                <span className="text-foreground font-semibold">{formatPromptApplied(room)}</span>
              </span>
              <span className="text-muted-foreground text-xs">
                Agent Role:{' '}
                <span className="text-foreground font-semibold">
                  {room.agentRole ? `${getAgentRoleLabel(room.agentRole)} 에이전트` : '미기록'}
                </span>
              </span>
              <span className="text-muted-foreground text-xs">
                Feedback Condition:{' '}
                <span className="text-foreground font-semibold">
                  {formatFeedbackCondition(room)}
                </span>
              </span>
              <span className="text-muted-foreground text-xs">
                참가자 {room.numParticipants}명
                {(room.numAgents ?? 0) > 0 && ` · AI ${room.numAgents}명`}
                {(room.numEgress ?? 0) > 0 && ` · 세션 녹음 연결 ${room.numEgress}개`}
              </span>
            </div>
            <button
              onClick={() => handleTerminate(room.name)}
              disabled={terminating === room.name}
              className="rounded-md border px-3 py-1 text-xs font-semibold transition-colors enabled:border-red-400 enabled:text-red-500 enabled:hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {terminating === room.name ? '종료 중...' : '세션 종료'}
            </button>
          </div>
        ))}
      </div>

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-destructive'}`}>
          [{message.room}] {message.text}
        </p>
      )}
    </section>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('settings');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [classStartInput, setClassStartInput] = useState('');
  const [groupsInput, setGroupsInput] = useState('');
  const [realtimeSessionKey, setRealtimeSessionKey] = useState(0);
  const [pendingRole, setPendingRole] = useState<AgentRole | null>(null);
  const [roleChangeStatus, setRoleChangeStatus] = useState<string | null>(null);
  const [feedbackConditions, setFeedbackConditions] = useState<FeedbackConditionOption[]>([]);
  const [pendingFeedbackCondition, setPendingFeedbackCondition] = useState<string | null>(null);
  const [feedbackChangeStatus, setFeedbackChangeStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((s: SettingsResponse) => {
        setSettings(s);
        setFeedbackConditions(s.feedbackConditions ?? []);
        setClassStartInput(String(s.classStart));
        setGroupsInput(String(s.numGroupsPerClass));
      });
  }, []);

  async function saveSettings(next: Settings) {
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof data.error === 'string' ? data.error : '설정 저장에 실패했습니다.';
      throw new Error(message);
    }
    const saved = data as SettingsResponse;
    setSettings(saved);
    if (saved.feedbackConditions) {
      setFeedbackConditions(saved.feedbackConditions);
    }
    setClassStartInput(String(saved.classStart));
    setGroupsInput(String(saved.numGroupsPerClass));
    setSavedAt(new Date().toLocaleTimeString('ko-KR'));
  }

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    setSaving(true);
    try {
      await saveSettings({ ...settings, ...patch });
    } catch (error) {
      const message = error instanceof Error ? error.message : '설정 저장에 실패했습니다.';
      window.alert(message);
    } finally {
      setSaving(false);
    }
  }

  async function fetchRealtimeRoomNames() {
    const roomsRes = await fetch('/api/rooms', { cache: 'no-store' });
    if (!roomsRes.ok) {
      throw new Error('개별 세션 목록을 불러오지 못했습니다.');
    }

    const data = (await roomsRes.json()) as RealtimeRoomsResponse;
    return (data.realtimeRooms ?? [])
      .map((room) => room.name)
      .filter((name): name is string => Boolean(name));
  }

  async function terminateRealtimeRoom(room: string) {
    const res = await fetch('/api/rooms/terminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = typeof data.error === 'string' ? data.error : '세션 종료 실패';
      throw new Error(`[${room}] ${message}`);
    }
  }

  async function terminateRealtimeSessionsAndWait(setStatus: (message: string) => void) {
    const startedAt = Date.now();
    setStatus('개별 세션 목록을 확인하는 중입니다...');
    const targetRooms = new Set(await fetchRealtimeRoomNames());
    let remainingRooms = Array.from(targetRooms);

    while (remainingRooms.length > 0) {
      setStatus(`개별 세션 ${remainingRooms.length}개를 종료하는 중입니다...`);
      await Promise.all(remainingRooms.map((room) => terminateRealtimeRoom(room)));
      setStatus('전체 세션 종료 완료를 확인하는 중입니다...');
      await sleep(REALTIME_TERMINATION_POLL_MS);
      remainingRooms = (await fetchRealtimeRoomNames()).filter((room) => targetRooms.has(room));

      if (remainingRooms.length > 0 && Date.now() - startedAt >= REALTIME_TERMINATION_TIMEOUT_MS) {
        throw new Error(`아직 종료되지 않은 개별 세션이 있습니다: ${remainingRooms.join(', ')}`);
      }
    }
  }

  async function handleAgentRoleChange(role: AgentRole) {
    if (!settings || settings.agentRole === role) return;

    const nextLabel = getAgentRoleLabel(role);
    const confirmed = window.confirm(
      [
        `에이전트 상호작용 방식을 [${nextLabel} 에이전트]로 변경하면 현재 진행 중인 모든 개별 세션이 종료됩니다.`,
        '',
        `변경 후에는 [${nextLabel} 에이전트] 방식으로만 새 개별 세션을 생성할 수 있습니다.`,
        '',
        '계속하시겠습니까?',
      ].join('\n')
    );
    if (!confirmed) return;

    setSaving(true);
    setPendingRole(role);
    setRoleChangeStatus(null);
    let resetLocked = false;
    try {
      setRoleChangeStatus('학생 재입장을 잠시 중지하는 중입니다...');
      await saveSettings({ ...settings, realtimeResetting: true });
      resetLocked = true;
      await terminateRealtimeSessionsAndWait(setRoleChangeStatus);
      setRoleChangeStatus('모든 개별 세션 종료를 확인했습니다. 설정을 저장하는 중입니다...');
      await saveSettings({ ...settings, agentRole: role, realtimeResetting: false });
      resetLocked = false;
      setRealtimeSessionKey((key) => key + 1);
    } catch (error) {
      if (resetLocked) {
        await saveSettings({ ...settings, realtimeResetting: false }).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : '상호작용 방식 변경에 실패했습니다.';
      window.alert(message);
    } finally {
      setSaving(false);
      setPendingRole(null);
      setRoleChangeStatus(null);
    }
  }

  async function handleFeedbackConditionChange(feedbackConditionId: string) {
    if (!settings || settings.feedbackConditionId === feedbackConditionId) return;

    const selected = feedbackConditions.find((condition) => condition.id === feedbackConditionId);
    const label = selected?.title ?? feedbackConditionId;
    const confirmed = window.confirm(
      [
        `Feedback Condition을 [${label}]로 변경하면 현재 진행 중인 모든 개별 세션이 종료됩니다.`,
        '',
        `변경 후에는 [${label}] 조건으로만 새 개별 세션을 생성할 수 있습니다.`,
        '',
        '계속하시겠습니까?',
      ].join('\n')
    );
    if (!confirmed) return;

    setSaving(true);
    setPendingFeedbackCondition(feedbackConditionId);
    setFeedbackChangeStatus(null);
    let resetLocked = false;
    try {
      setFeedbackChangeStatus('학생 재입장을 잠시 중지하는 중입니다...');
      await saveSettings({ ...settings, realtimeResetting: true });
      resetLocked = true;
      await terminateRealtimeSessionsAndWait(setFeedbackChangeStatus);
      setFeedbackChangeStatus('모든 개별 세션 종료를 확인했습니다. 설정을 저장하는 중입니다...');
      await saveSettings({ ...settings, feedbackConditionId, realtimeResetting: false });
      resetLocked = false;
      setRealtimeSessionKey((key) => key + 1);
    } catch (error) {
      if (resetLocked) {
        await saveSettings({ ...settings, realtimeResetting: false }).catch(() => undefined);
      }
      const message =
        error instanceof Error ? error.message : 'Feedback Condition 변경에 실패했습니다.';
      window.alert(message);
    } finally {
      setSaving(false);
      setPendingFeedbackCondition(null);
      setFeedbackChangeStatus(null);
    }
  }

  function handleClassStartBlur() {
    const n = parseInt(classStartInput);
    if (!isNaN(n) && n >= 1 && n !== settings?.classStart) {
      update({ classStart: n, activeClass: n });
    } else {
      setClassStartInput(String(settings?.classStart ?? 1));
    }
  }

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      </div>
    );
  }

  const classNumbers = Array.from(
    { length: settings.numClasses },
    (_, i) => settings.classStart + i
  );
  const classEnd = settings.classStart + settings.numClasses - 1;

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-8 px-8 pt-20 pb-8 ${
        activeTab === 'prompts' ? 'max-w-5xl' : 'max-w-lg'
      }`}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">관리자</h1>
        <div className="flex items-center gap-3">
          <a
            href="/admin/dashboard"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            대시보드 →
          </a>
          <AdminLogoutButton />
        </div>
      </div>

      <div className="bg-muted grid grid-cols-2 rounded-lg p-1">
        {ADMIN_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'prompts' ? (
        <PromptEditorView />
      ) : (
        <>
          {/* 반 번호 시작 */}
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-foreground text-sm font-semibold">반 번호 시작</h2>
              <p className="text-muted-foreground text-xs">
                첫 번째 반의 번호를 설정합니다. (현재: {settings.classStart}반 ~ {classEnd}반)
              </p>
            </div>
            <input
              type="number"
              min={1}
              value={classStartInput}
              onChange={(e) => setClassStartInput(e.target.value)}
              onBlur={handleClassStartBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleClassStartBlur()}
              disabled={saving}
              className="border-input bg-background text-foreground w-28 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
            />
          </section>

          {/* 전체 학급 수 */}
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-foreground text-sm font-semibold">전체 학급 수</h2>
              <p className="text-muted-foreground text-xs">담당 학급의 총 수를 설정합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  onClick={() =>
                    update({
                      numClasses: n,
                      activeClass: Math.min(settings.activeClass, settings.classStart + n - 1),
                    })
                  }
                  disabled={saving}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    settings.numClasses === n
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-muted text-foreground'
                  }`}
                >
                  {n}개 반
                </button>
              ))}
            </div>
          </section>

          {/* 현재 활성 반 */}
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-foreground text-sm font-semibold">현재 수업 중인 반</h2>
              <p className="text-muted-foreground text-xs">
                {settings.agentMode === 'pipeline'
                  ? '학생 로비에는 이 반의 그룹만 표시됩니다.'
                  : '개별 대화방 이름과 학생 세션 현황에 이 반 번호가 사용됩니다.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {classNumbers.map((c) => (
                <button
                  key={c}
                  onClick={() => update({ activeClass: c })}
                  disabled={saving}
                  className={`rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                    settings.activeClass === c
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-muted text-foreground'
                  }`}
                >
                  {c}반
                  {settings.activeClass === c && (
                    <span className="ml-1.5 text-xs font-normal opacity-80">● 활성</span>
                  )}
                </button>
              ))}
            </div>
          </section>

          <hr className="border-border" />

          {/* 수업 운영 모드 */}
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-foreground text-sm font-semibold">수업 운영 모드</h2>
              <p className="text-muted-foreground text-xs">
                학생 로비와 배치할 에이전트 종류가 함께 바뀝니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['pipeline', 'realtime'] as AgentMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => update({ agentMode: mode })}
                  disabled={saving}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                    settings.agentMode === mode
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-muted text-foreground'
                  }`}
                >
                  <span className="block text-sm font-semibold">{getAgentModeLabel(mode)}</span>
                  <span
                    className={`mt-1 block text-xs ${settings.agentMode === mode ? 'opacity-80' : 'text-muted-foreground'}`}
                  >
                    {mode === 'pipeline'
                      ? 'n:1 pipeline (STT -> LLM -> TTS)'
                      : '1:1 realtime (Speech-to-Speech)'}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <hr className="border-border" />

          {settings.agentMode === 'realtime' && (
            <>
              {/* 에이전트 상호작용 방식 */}
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="text-foreground text-sm font-semibold">Agent Role</h2>
                  <p className="text-muted-foreground text-xs">
                    실험 조건(1) 입니다. 에이전트의 상호작용 방식을 정합니다.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['dominant', 'collaborative'] as AgentRole[]).map((role) => (
                    <button
                      key={role}
                      onClick={() => handleAgentRoleChange(role)}
                      disabled={saving}
                      aria-busy={pendingRole === role}
                      className={`rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                        settings.agentRole === role
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:bg-muted text-foreground'
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {pendingRole === role ? '변경 중...' : `${getAgentRoleLabel(role)} Agent`}
                      </span>
                      <span
                        className={`mt-1 block text-xs ${settings.agentRole === role ? 'opacity-80' : 'text-muted-foreground'}`}
                      >
                        {role === 'dominant'
                          ? '에이전트가 대화와 과제 진행을 주도'
                          : '학생과 에이전트가 선택과 결정을 공유'}
                      </span>
                    </button>
                  ))}
                </div>
                {pendingRole && roleChangeStatus && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="border-border bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className="border-muted-foreground/30 border-t-foreground size-4 shrink-0 animate-spin rounded-full border-2"
                    />
                    <span>{roleChangeStatus}</span>
                  </div>
                )}
              </section>

              {/* 피드백 조건 */}
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="text-foreground text-sm font-semibold">Feedback Condition</h2>
                  <p className="text-muted-foreground text-xs">
                    실험 조건(2) 입니다. 학생 오류 피드백 방식을 정합니다.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {feedbackConditions.map((condition) => (
                    <button
                      key={condition.id}
                      onClick={() => handleFeedbackConditionChange(condition.id)}
                      disabled={saving}
                      aria-busy={pendingFeedbackCondition === condition.id}
                      className={`rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                        settings.feedbackConditionId === condition.id
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:bg-muted text-foreground'
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {pendingFeedbackCondition === condition.id ? '변경 중...' : condition.title}
                      </span>
                      <span
                        className={`mt-1 block text-xs ${
                          settings.feedbackConditionId === condition.id
                            ? 'opacity-80'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {getFeedbackConditionDescription(condition.id)}
                      </span>
                    </button>
                  ))}
                </div>
                {pendingFeedbackCondition && feedbackChangeStatus && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="border-border bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className="border-muted-foreground/30 border-t-foreground size-4 shrink-0 animate-spin rounded-full border-2"
                    />
                    <span>{feedbackChangeStatus}</span>
                  </div>
                )}
              </section>

              <hr className="border-border" />
            </>
          )}

          {settings.agentMode === 'pipeline' && (
            <>
              {/* 반당 그룹 수 */}
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="text-foreground text-sm font-semibold">반당 그룹 수</h2>
                  <p className="text-muted-foreground text-xs">
                    모든 반에 동일하게 적용됩니다. (현재: {settings.numGroupsPerClass}그룹)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={groupsInput}
                    onChange={(e) => setGroupsInput(e.target.value)}
                    onBlur={() => {
                      const n = parseInt(groupsInput);
                      if (!isNaN(n) && n >= 1) {
                        update({ numGroupsPerClass: n });
                      } else {
                        setGroupsInput(String(settings.numGroupsPerClass));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const n = parseInt(groupsInput);
                        if (!isNaN(n) && n >= 1) update({ numGroupsPerClass: n });
                        else setGroupsInput(String(settings.numGroupsPerClass));
                      }
                    }}
                    disabled={saving}
                    className="border-input bg-background text-foreground w-24 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
                  />
                  <span className="text-muted-foreground text-sm">그룹</span>
                </div>
              </section>
            </>
          )}

          {/* 에이전트 배치 */}
          {settings.agentMode === 'pipeline' ? (
            <AgentDispatchSection
              activeClass={settings.activeClass}
              numGroupsPerClass={settings.numGroupsPerClass}
            />
          ) : (
            <RealtimeSessionSection
              key={realtimeSessionKey}
              feedbackConditions={feedbackConditions}
            />
          )}

          <hr className="border-border" />

          {/* 설정 요약 */}
          <div className="bg-muted rounded-lg p-4 text-sm">
            <p className="font-medium">현재 설정 요약</p>
            <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
              <li>
                활성 반:{' '}
                <span className="text-foreground font-semibold">{settings.activeClass}반</span>
              </li>
              <li>
                운영 모드:{' '}
                <span className="text-foreground font-semibold">
                  {getAgentModeLabel(settings.agentMode)}
                </span>
              </li>
              {settings.agentMode === 'realtime' && (
                <>
                  <li>
                    상호작용 방식:{' '}
                    <span className="text-foreground font-semibold">
                      {getAgentRoleLabel(settings.agentRole)} 에이전트
                    </span>
                  </li>
                  <li>
                    Feedback Condition:{' '}
                    <span className="text-foreground font-semibold">
                      {feedbackConditions.find(
                        (condition) => condition.id === settings.feedbackConditionId
                      )?.title ?? settings.feedbackConditionId}
                    </span>
                  </li>
                </>
              )}
              <li>
                학급 범위:{' '}
                <span className="text-foreground font-semibold">
                  {settings.classStart}반 ~ {classEnd}반
                </span>
              </li>
              {settings.agentMode === 'pipeline' && (
                <li>
                  반당 그룹:{' '}
                  <span className="text-foreground font-semibold">
                    {settings.numGroupsPerClass}개
                  </span>
                </li>
              )}
              <li>
                학생 입장 방식:{' '}
                <span className="text-foreground font-semibold">
                  {settings.agentMode === 'pipeline'
                    ? `${settings.activeClass}반-1그룹 ~ ${settings.activeClass}반-${settings.numGroupsPerClass}그룹`
                    : '학생별 개별 방 자동 생성'}
                </span>
              </li>
            </ul>
            {savedAt && (
              <p className="text-muted-foreground mt-2 text-xs">마지막 저장: {savedAt}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
