'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RealtimePromptConfig, RealtimePromptState } from '@/lib/realtime-prompt-config';

type PromptField = keyof RealtimePromptConfig;

type PromptResponse = RealtimePromptState;

const PROMPT_FIELDS: {
  key: PromptField;
  title: string;
  description: string;
  rows: number;
}[] = [
  {
    key: 'basePrompt',
    title: '공통 프롬프트',
    description: 'Realtime 에이전트의 정체성, 언어 수준, 안전 규칙, 기본 대화 규칙입니다.',
    rows: 24,
  },
  {
    key: 'dominantPrompt',
    title: '주도적 에이전트 추가 규칙',
    description: '주도적 조건에서 공통 프롬프트 뒤에 추가되는 규칙입니다.',
    rows: 10,
  },
  {
    key: 'collaborativePrompt',
    title: '협력적 에이전트 역할 프롬프트',
    description: '협력적 role 조건에서 공통 프롬프트 뒤에 추가되는 상호작용 규칙입니다.',
    rows: 14,
  },
  {
    key: 'taskCardPrompt',
    title: 'Lesson 4 Task Card',
    description: 'Lesson 4의 과업 목표, 정보 격차, 선택지, 완성 기준입니다.',
    rows: 24,
  },
];

const EMPTY_PROMPT: RealtimePromptConfig = {
  basePrompt: '',
  dominantPrompt: '',
  collaborativePrompt: '',
  taskCardPrompt: '',
};

function samePrompt(a: RealtimePromptConfig | null, b: RealtimePromptConfig | null) {
  if (!a || !b) return false;
  return (
    a.basePrompt === b.basePrompt &&
    a.dominantPrompt === b.dominantPrompt &&
    a.collaborativePrompt === b.collaborativePrompt &&
    a.taskCardPrompt === b.taskCardPrompt
  );
}

function confirmPromptChange(action: string) {
  return window.confirm(
    `${action}\n\n변경된 프롬프트는 현재 진행 중인 세션에는 적용되지 않고, 다음에 새로 생성되는 개별 세션부터 반영됩니다.\n\n계속할까요?`
  );
}

export function PromptEditorView() {
  const [prompt, setPrompt] = useState<RealtimePromptConfig>(EMPTY_PROMPT);
  const [savedPrompt, setSavedPrompt] = useState<RealtimePromptConfig | null>(null);
  const [usingDefault, setUsingDefault] = useState(false);
  const [promptId, setPromptId] = useState('default');
  const [promptSavedAt, setPromptSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const hasChanges = useMemo(() => !samePrompt(prompt, savedPrompt), [prompt, savedPrompt]);

  function formatPromptSavedAt(value: string | null) {
    return value ? new Date(value).toLocaleString('ko-KR') : '저장 이력 없음';
  }

  async function loadPrompt() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/prompts/realtime', { cache: 'no-store' });
      const data: PromptResponse = await res.json();
      setPrompt({
        basePrompt: data.basePrompt,
        dominantPrompt: data.dominantPrompt,
        collaborativePrompt: data.collaborativePrompt,
        taskCardPrompt: data.taskCardPrompt,
      });
      setSavedPrompt({
        basePrompt: data.basePrompt,
        dominantPrompt: data.dominantPrompt,
        collaborativePrompt: data.collaborativePrompt,
        taskCardPrompt: data.taskCardPrompt,
      });
      setUsingDefault(data.usingDefault);
      setPromptId(data.promptId);
      setPromptSavedAt(data.savedAt);
    } catch {
      setMessage({ text: '프롬프트를 불러오지 못했습니다.', ok: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrompt();
  }, []);

  async function savePrompt() {
    if (!confirmPromptChange('Realtime 프롬프트 변경사항을 저장합니다.')) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/prompts/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prompt),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '프롬프트 저장 실패', ok: false });
        return;
      }
      const saved: PromptResponse = data;
      const next = {
        basePrompt: saved.basePrompt,
        dominantPrompt: saved.dominantPrompt,
        collaborativePrompt: saved.collaborativePrompt,
        taskCardPrompt: saved.taskCardPrompt,
      };
      setPrompt(next);
      setSavedPrompt(next);
      setUsingDefault(saved.usingDefault);
      setPromptId(saved.promptId);
      setPromptSavedAt(saved.savedAt);
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: '프롬프트를 저장했습니다.', ok: true });
    } catch {
      setMessage({ text: '프롬프트 저장 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function resetPrompt() {
    if (!confirmPromptChange('Realtime 프롬프트를 기본값으로 복원합니다.')) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/prompts/realtime', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '기본값 복원 실패', ok: false });
        return;
      }
      const saved: PromptResponse = data;
      const next = {
        basePrompt: saved.basePrompt,
        dominantPrompt: saved.dominantPrompt,
        collaborativePrompt: saved.collaborativePrompt,
        taskCardPrompt: saved.taskCardPrompt,
      };
      setPrompt(next);
      setSavedPrompt(next);
      setUsingDefault(saved.usingDefault);
      setPromptId(saved.promptId);
      setPromptSavedAt(saved.savedAt);
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: '기본 프롬프트로 복원했습니다.', ok: true });
    } catch {
      setMessage({ text: '기본값 복원 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-foreground text-sm font-semibold">Realtime 프롬프트</h2>
            <p className="text-muted-foreground text-xs">
              저장된 변경사항은 새로 시작하는 개별 대화 세션부터 적용됩니다.
            </p>
          </div>
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-1 text-xs">
            {usingDefault ? '기본값 사용 중' : '사용자 설정 사용 중'}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            프롬프트 ID: <span className="text-foreground font-mono font-semibold">{promptId}</span>
          </span>
          <span>
            저장 시각:{' '}
            <span className="text-foreground font-semibold">
              {formatPromptSavedAt(promptSavedAt)}
            </span>
          </span>
        </div>
      </section>

      {loading ? (
        <p className="text-muted-foreground text-sm">프롬프트를 불러오는 중...</p>
      ) : (
        PROMPT_FIELDS.map((field) => (
          <section key={field.key} className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-foreground text-sm font-semibold">{field.title}</h3>
                <p className="text-muted-foreground text-xs">{field.description}</p>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {prompt[field.key].length.toLocaleString('ko-KR')}자
              </span>
            </div>
            <textarea
              value={prompt[field.key]}
              rows={field.rows}
              spellCheck={false}
              onChange={(e) =>
                setPrompt((current) => ({
                  ...current,
                  [field.key]: e.target.value,
                }))
              }
              className="border-input bg-background text-foreground focus:ring-primary min-h-32 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 disabled:opacity-50"
              disabled={saving}
            />
          </section>
        ))
      )}

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-destructive'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={savePrompt} disabled={loading || saving || !hasChanges}>
          {saving ? '저장 중...' : '저장'}
        </Button>
        <button
          onClick={resetPrompt}
          disabled={loading || saving}
          className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          기본값으로 복원
        </button>
        <button
          onClick={loadPrompt}
          disabled={loading || saving}
          className="text-muted-foreground hover:text-foreground px-2 py-2 text-sm underline underline-offset-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          다시 불러오기
        </button>
        {hasChanges && (
          <span className="text-muted-foreground text-xs">저장되지 않은 변경사항</span>
        )}
        {savedAt && <span className="text-muted-foreground text-xs">마지막 저장: {savedAt}</span>}
      </div>
    </div>
  );
}
