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
import { type StudentProfile, studentDefaultDisplayName } from '@/lib/student';

interface LobbyViewProps {
  onJoin: (
    displayName: string,
    roomName: string,
    agentMode: AgentMode,
    options?: {
      activityType?: ActivityType;
      evaluationId?: string;
      sessionPurpose?: SessionPurpose;
    }
  ) => void;
  onLogout: () => void;
  sessionNotice?: string | null;
  student: StudentProfile;
}

export function LobbyView({
  onJoin,
  onLogout,
  sessionNotice,
  student,
  ref,
}: React.ComponentProps<'div'> & LobbyViewProps) {
  const [displayName, setDisplayName] = useState(studentDefaultDisplayName(student));
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [availableActivity, setAvailableActivity] = useState<ActivityType>('task_solution');
  const [selectedActivity, setSelectedActivity] = useState<ActivityType | null>(null);
  const [activeClass, setActiveClass] = useState<number | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>('pipeline');
  const [realtimeResetting, setRealtimeResetting] = useState(false);
  const [rooms, setRooms] = useState<{ name: string; numParticipants: number }[]>([]);
  const [error, setError] = useState('');
  const displayNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    displayNameRef.current?.focus();
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

  useEffect(() => {
    setDisplayName(studentDefaultDisplayName(student));
  }, [student]);

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
      // ignore
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
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
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
    const slug = name ? makeStudentSlug(name) : 'student';
    // Realtime rooms identify one logged-in student; pipeline rooms use the active class/group.
    return `${prefix}_${student.classNumber}_${student.rollNumber}_${slug}_${makeRoomSuffix()}`;
  }

  function handleJoin() {
    const normalizedDisplayName = displayName.trim();
    if (!normalizedDisplayName) {
      setError('에이전트가 부를 이름을 입력해주세요.');
      return;
    }
    if (agentMode === 'pipeline' && !selectedRoomName) {
      setError('그룹을 선택해주세요.');
      return;
    }
    if (agentMode === 'realtime') {
      if (realtimeResetting) {
        setError('개별 세션 초기화 중입니다. 잠시 후 다시 입장해주세요.');
        return;
      }
      const activityType = selectedActivity;
      if (!activityType) {
        setError('활동을 선택해주세요.');
        return;
      }
      const roomName = makeActivityRoomName(normalizedDisplayName, activityType);
      onJoin(normalizedDisplayName, roomName, 'realtime', {
        activityType,
        sessionPurpose: getSessionPurposeForActivity(activityType),
      });
      return;
    }
    const roomName = selectedRoomName;
    if (!roomName) return;
    onJoin(normalizedDisplayName, roomName, agentMode);
  }

  const joinDisabled =
    !displayName.trim() ||
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

      <div className="bg-muted flex items-center justify-between rounded-lg px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground text-xs font-semibold">{student.name}</span>
          <span className="text-muted-foreground text-xs">
            {student.classNumber}반 · {student.rollNumber}번 · {student.studentNumber}
          </span>
        </div>
        <button
          onClick={onLogout}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors"
        >
          다시 로그인
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-foreground text-sm font-semibold">에이전트가 부를 이름</label>
        <input
          ref={displayNameRef}
          type="text"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="예: Minji Kim"
          maxLength={40}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        />
        <p className="text-muted-foreground text-xs">
          영어 이름 표기가 다르면 이곳에서 수정한 뒤 입장하세요.
        </p>
      </div>

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
          입장하면 학생별 개별 대화방이 자동으로 생성됩니다.
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
