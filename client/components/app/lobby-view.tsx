'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type AgentMode, getAgentModeLabel } from '@/lib/agent-mode';
import {
  type ActivityType,
  type SessionPurpose,
  getActivityTypeForSessionPurpose,
  getActivityTypeLabel,
  getSessionPurposeForActivity,
  normalizeSessionPurpose,
} from '@/lib/session-activity';

interface LobbyViewProps {
  onJoin: (
    participantName: string,
    roomName: string,
    agentMode: AgentMode,
    options?: {
      activityType?: ActivityType;
      evaluationId?: string;
      sessionPurpose?: SessionPurpose;
    }
  ) => void;
  sessionNotice?: string | null;
}

export function LobbyView({
  onJoin,
  sessionNotice,
  ref,
}: React.ComponentProps<'div'> & LobbyViewProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [availableActivity, setAvailableActivity] = useState<ActivityType>('task_solution');
  const [selectedActivity, setSelectedActivity] = useState<ActivityType | null>(null);
  const [activeClass, setActiveClass] = useState<number | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>('pipeline');
  const [realtimeResetting, setRealtimeResetting] = useState(false);
  const [rooms, setRooms] = useState<{ name: string; numParticipants: number }[]>([]);
  const [error, setError] = useState('');
  const firstNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstNameRef.current?.focus();
    fetchRooms();
    const interval = window.setInterval(fetchRooms, 2_000);
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') fetchRooms();
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, []);

  async function fetchRooms() {
    try {
      const res = await fetch('/api/rooms', { cache: 'no-store' });
      const data = await res.json();
      const nextRooms = data.rooms ?? [];
      const nextAgentMode = data.agentMode === 'realtime' ? 'realtime' : 'pipeline';
      const nextSessionPurpose = normalizeSessionPurpose(data.sessionPurpose);
      const nextActivity = getActivityTypeForSessionPurpose(nextSessionPurpose);
      setRooms(nextRooms);
      setActiveClass(data.activeClass ?? null);
      setAgentMode(nextAgentMode);
      setAvailableActivity(nextActivity);
      setSelectedActivity((current) => (current === nextActivity ? current : null));
      setRealtimeResetting(data.realtimeResetting === true);
      setSelectedGroup((current) =>
        nextAgentMode === 'pipeline' && current !== null && current <= nextRooms.length
          ? current
          : null
      );
    } catch {
      // 무시
    }
  }

  const selectedRoomName =
    agentMode === 'pipeline' && activeClass !== null && selectedGroup !== null
      ? `${activeClass}반-${selectedGroup}그룹`
      : null;

  function makeStudentSlug(name: string) {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'student'
    );
  }

  function makeRoomSuffix() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : String(Date.now()).slice(-8);
  }

  function makeActivityRoomName(name: string, activityType: ActivityType) {
    const prefix = activityType === 'free_conversation' ? 'eval' : 'task';
    const slug = makeStudentSlug(name);
    return `${prefix}-${activeClass ?? 'class'}-${slug}-${makeRoomSuffix()}`;
  }

  function handleJoin() {
    if (!firstName.trim()) {
      setError('이름(First Name)을 입력해주세요.');
      return;
    }
    if (!lastName.trim()) {
      setError('성(Last Name)을 입력해주세요.');
      return;
    }
    if (agentMode === 'pipeline' && !selectedRoomName) {
      setError('그룹을 선택해주세요.');
      return;
    }
    if (agentMode === 'realtime' && realtimeResetting) {
      setError('개별 세션 초기화 중입니다. 잠시 후 다시 입장해주세요.');
      return;
    }
    const participantName = `${firstName.trim()} ${lastName.trim()}`;
    if (agentMode === 'realtime') {
      if (!selectedActivity) {
        setError('활동을 선택해주세요.');
        return;
      }
      const roomName = makeActivityRoomName(participantName, selectedActivity);
      onJoin(participantName, roomName, 'realtime', {
        activityType: selectedActivity,
        sessionPurpose: getSessionPurposeForActivity(selectedActivity),
      });
      return;
    }
    const roomName = selectedRoomName;
    if (!roomName) return;
    onJoin(participantName, roomName, agentMode);
  }

  const previewName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
  const joinDisabled =
    !firstName.trim() ||
    !lastName.trim() ||
    (agentMode === 'pipeline' && !selectedRoomName) ||
    (agentMode === 'realtime' && (!selectedActivity || realtimeResetting));

  return (
    <div ref={ref} className="mx-auto flex w-full max-w-sm flex-col gap-5">
      <div className="bg-muted flex items-center justify-between rounded-lg px-3 py-2">
        <span className="text-muted-foreground text-xs">수업 운영 모드</span>
        <span className="text-foreground text-xs font-semibold">
          {getAgentModeLabel(agentMode)}
        </span>
      </div>

      {sessionNotice && (
        <p className="border-border bg-muted/60 text-muted-foreground rounded-md border px-3 py-2 text-xs">
          {sessionNotice}
        </p>
      )}

      {/* 이름 입력 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-foreground text-sm font-semibold">이름</label>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-muted-foreground text-xs">이름 (First Name)</span>
            <input
              ref={firstNameRef}
              type="text"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="예: Jungkook"
              maxLength={20}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-muted-foreground text-xs">성 (Last Name)</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="예: Jeon"
              maxLength={20}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
        </div>
        {previewName && (
          <p className="text-muted-foreground text-xs">
            에이전트가 부를 이름: <span className="text-foreground font-medium">{previewName}</span>
          </p>
        )}
      </div>

      {/* 그룹 선택 */}
      {agentMode === 'pipeline' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-foreground text-sm font-semibold">
              그룹 선택
              {activeClass !== null && (
                <span className="text-muted-foreground ml-2 font-normal">({activeClass}반)</span>
              )}
            </label>
            <button
              onClick={fetchRooms}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors"
            >
              새로고침
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {rooms.map((room, i) => {
              const groupNum = i + 1;
              return (
                <button
                  key={room.name}
                  onClick={() => {
                    setSelectedGroup(groupNum);
                    setError('');
                  }}
                  className={`flex flex-col items-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    selectedGroup === groupNum
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-muted text-foreground'
                  }`}
                >
                  <span>{groupNum}그룹</span>
                  {room.numParticipants > 0 && (
                    <span
                      className={`text-xs ${selectedGroup === groupNum ? 'opacity-80' : 'text-muted-foreground'}`}
                    >
                      {room.numParticipants}명
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {agentMode === 'realtime' && (
        <div className="flex flex-col gap-2">
          <label className="text-foreground text-sm font-semibold">활동 선택</label>
          <div className="grid grid-cols-1 gap-2">
            {([availableActivity] as ActivityType[]).map((activityType) => (
              <button
                key={activityType}
                type="button"
                onClick={() => {
                  setSelectedActivity(activityType);
                  setError('');
                }}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  selectedActivity === activityType
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-muted text-foreground'
                }`}
              >
                <span className="block text-sm font-semibold">
                  {getActivityTypeLabel(activityType)}
                </span>
                <span
                  className={`mt-1 block text-xs ${
                    selectedActivity === activityType ? 'opacity-80' : 'text-muted-foreground'
                  }`}
                >
                  {activityType === 'free_conversation'
                    ? 'Kate와 서로 알아가기'
                    : 'Kate와 영어 과제 해결하기'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {agentMode === 'pipeline' && selectedRoomName && (
        <p className="text-muted-foreground text-xs">
          입장할 방: <span className="text-foreground font-semibold">{selectedRoomName}</span>
        </p>
      )}

      {agentMode === 'realtime' && realtimeResetting && (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
        >
          <span
            aria-hidden="true"
            className="border-muted-foreground/30 border-t-foreground size-4 shrink-0 animate-spin rounded-full border-2"
          />
          <span>선생님이 개별 세션을 초기화 중입니다. 완료되면 자동으로 입장할 수 있습니다.</span>
        </div>
      )}

      {agentMode === 'realtime' && !realtimeResetting && (
        <p className="text-muted-foreground text-xs">
          활동을 선택하면 학생별 개별 대화방이 자동으로 생성됩니다.
        </p>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      <Button
        size="lg"
        onClick={handleJoin}
        disabled={joinDisabled}
        className="w-full rounded-full font-mono text-xs font-bold tracking-wider uppercase"
      >
        {realtimeResetting ? '준비 중...' : '입장하기'}
      </Button>
    </div>
  );
}
