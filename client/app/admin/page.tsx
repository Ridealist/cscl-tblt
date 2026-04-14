'use client';

import { useEffect, useState, useCallback } from 'react';

interface Settings {
  numClasses: number;
  numGroupsPerClass: number;
  classStart: number;
  activeClass: number;
}

// ─── 에이전트 배치 섹션 ────────────────────────────────────────────────────────

interface AgentStatus {
  room: string;
  hasAgent: boolean | null; // null = 로딩 중
}

function AgentDispatchSection({ activeClass, numGroupsPerClass }: { activeClass: number; numGroupsPerClass: number }) {
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [message, setMessage] = useState<{ room: string; text: string; ok: boolean } | null>(null);

  const roomNames = Array.from(
    { length: numGroupsPerClass },
    (_, i) => `${activeClass}반-${i + 1}그룹`,
  );

  const fetchStatuses = useCallback(async () => {
    setStatuses(roomNames.map((room) => ({ room, hasAgent: null })));
    const results = await Promise.all(
      roomNames.map(async (room) => {
        try {
          const res = await fetch(`/api/dispatch?room=${encodeURIComponent(room)}`);
          const data = await res.json();
          return { room, hasAgent: data.hasAgent as boolean };
        } catch {
          return { room, hasAgent: false };
        }
      }),
    );
    setStatuses(results);
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

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-sm font-semibold">에이전트 배치 현황</h2>
          <p className="text-muted-foreground text-xs">에이전트가 없는 방에만 수동 배치가 가능합니다.</p>
        </div>
        <button
          onClick={fetchStatuses}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors"
        >
          새로고침
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {statuses.map(({ room, hasAgent }) => (
          <div key={room} className="border-border flex items-center justify-between rounded-lg border px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="text-foreground text-sm font-medium">{room}</span>
              {hasAgent === null ? (
                <span className="text-muted-foreground text-xs">확인 중...</span>
              ) : hasAgent ? (
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
            </div>
            <button
              onClick={() => handleDispatch(room)}
              disabled={hasAgent !== false || dispatching === room}
              className="rounded-md border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 enabled:border-blue-500 enabled:text-blue-600 enabled:hover:bg-blue-50"
            >
              {dispatching === room ? '배치 중...' : '수동 배치'}
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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [classStartInput, setClassStartInput] = useState('');
  const [groupsInput, setGroupsInput] = useState('');

  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((s: Settings) => {
        setSettings(s);
        setClassStartInput(String(s.classStart));
        setGroupsInput(String(s.numGroupsPerClass));
      });
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    setSaving(true);
    const next = { ...settings, ...patch };
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const saved: Settings = await res.json();
      setSettings(saved);
      setClassStartInput(String(saved.classStart));
      setGroupsInput(String(saved.numGroupsPerClass));
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
    } finally {
      setSaving(false);
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

  const classNumbers = Array.from({ length: settings.numClasses }, (_, i) => settings.classStart + i);
  const classEnd = settings.classStart + settings.numClasses - 1;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-8 pb-8 pt-20">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">관리자 설정</h1>
        <a
          href="/admin/dashboard"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          대시보드 →
        </a>
      </div>

      {/* 현재 활성 반 */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">현재 수업 중인 반</h2>
          <p className="text-muted-foreground text-xs">학생 로비에는 이 반의 그룹만 표시됩니다.</p>
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
              onClick={() => update({ numClasses: n, activeClass: Math.min(settings.activeClass, settings.classStart + n - 1) })}
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

      {/* 반당 그룹 수 */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">반당 그룹 수</h2>
          <p className="text-muted-foreground text-xs">모든 반에 동일하게 적용됩니다. (현재: {settings.numGroupsPerClass}그룹)</p>
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

      {/* 에이전트 배치 */}
      <AgentDispatchSection activeClass={settings.activeClass} numGroupsPerClass={settings.numGroupsPerClass} />

      <hr className="border-border" />

      {/* 설정 요약 */}
      <div className="bg-muted rounded-lg p-4 text-sm">
        <p className="font-medium">현재 설정 요약</p>
        <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
          <li>활성 반: <span className="text-foreground font-semibold">{settings.activeClass}반</span></li>
          <li>학급 범위: <span className="text-foreground font-semibold">{settings.classStart}반 ~ {classEnd}반</span></li>
          <li>반당 그룹: <span className="text-foreground font-semibold">{settings.numGroupsPerClass}개</span></li>
          <li>
            학생에게 보이는 방:{' '}
            <span className="text-foreground font-semibold">
              {settings.activeClass}반-1그룹 ~ {settings.activeClass}반-{settings.numGroupsPerClass}그룹
            </span>
          </li>
        </ul>
        {savedAt && <p className="text-muted-foreground mt-2 text-xs">마지막 저장: {savedAt}</p>}
      </div>
    </div>
  );
}
