'use client';

import { useEffect, useState } from 'react';

interface Settings {
  numClasses: number;
  numGroupsPerClass: number;
  classStart: number;
  activeClass: number;
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
