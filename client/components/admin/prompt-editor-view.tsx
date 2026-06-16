'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type AgentRole, getAgentRoleLabel, normalizeAgentRole } from '@/lib/agent-role';
import type {
  RealtimeFeedbackConditionSummary,
  RealtimePromptConfig,
  RealtimePromptState,
  RealtimePromptVersionSummary,
  RealtimeTaskCardSummary,
} from '@/lib/realtime-prompt-config';
import { type SessionPurpose, getSessionPurposeLabel } from '@/lib/session-activity';

type PromptField = keyof RealtimePromptConfig;

type PromptResponse = RealtimePromptState;
type PromptVersionSummary = RealtimePromptVersionSummary;
type EvaluationPromptResponse = {
  source: 'evaluation';
  usingDefault: boolean;
  activePromptVersionId: string | null;
  evaluationId: string;
  evaluationPromptId: string;
  evaluationPromptVersion?: string | null;
  evaluationCharacter: string;
  openingSentence: string;
  prompt: string;
  promptVersionCreatedAt: string | null;
  promptVersionHash: string | null;
  promptVersionId: string | null;
  promptVersionLabel: string | null;
  promptVersions: PromptVersionSummary[];
  savedAt: string | null;
  evaluations: Array<{
    id: string;
    character: string;
    file: string;
    promptId: string;
    version?: string | null;
    openingSentence: string;
  }>;
};
type RuntimeSettingsResponse = {
  agentRole?: unknown;
  feedbackConditionId?: unknown;
};

type PromptFieldConfig = {
  key: PromptField;
  title: string;
  description: string;
  rows: number;
};

type PromptGroup = {
  title: string;
  description: string;
  fields: PromptFieldConfig[];
};

const PROMPT_GROUPS: PromptGroup[] = [
  {
    title: 'Base Prompt',
    description: 'Realtime 에이전트의 정체성, 언어 수준, 안전 규칙, 기본 대화 규칙입니다.',
    fields: [
      {
        key: 'basePrompt',
        title: 'Common Prompt',
        description: '모든 Realtime 에이전트 역할에 공통으로 적용됩니다.',
        rows: 18,
      },
    ],
  },
  {
    title: 'Interlocutor Role Prompt',
    description: '상호작용 조건별로 Base Prompt 뒤에 추가되는 역할 규칙입니다.',
    fields: [
      {
        key: 'dominantPrompt',
        title: 'Dominant Prompt',
        description: 'Dominant Condition에서 추가되는 주도적 상호작용 규칙입니다.',
        rows: 18,
      },
      {
        key: 'collaborativePrompt',
        title: 'Collaborative Prompt',
        description: 'Collaborative Condition에서 추가되는 협력적 상호작용 규칙입니다.',
        rows: 18,
      },
    ],
  },
  {
    title: 'Feedback Condition Prompt',
    description: '운영 설정에서 선택된 feedback condition의 corrective feedback 규칙입니다.',
    fields: [
      {
        key: 'feedbackPrompt',
        title: 'Feedback Condition Prompt',
        description: '학생 오류에 대한 피드백 제공 방식을 제어합니다.',
        rows: 14,
      },
    ],
  },
];

const EMPTY_PROMPT: RealtimePromptConfig = {
  basePrompt: '',
  dominantPrompt: '',
  collaborativePrompt: '',
  feedbackConditionId: 'no_corrective',
  feedbackPrompt: '',
  taskCardId: 'school_event_invitation',
  taskCardPrompt: '',
};

function promptConfigFromResponse(data: RealtimePromptConfig): RealtimePromptConfig {
  return {
    basePrompt: data.basePrompt,
    dominantPrompt: data.dominantPrompt,
    collaborativePrompt: data.collaborativePrompt,
    feedbackConditionId: data.feedbackConditionId,
    feedbackPrompt: data.feedbackPrompt,
    taskCardId: data.taskCardId,
    taskCardPrompt: data.taskCardPrompt,
  };
}

function samePrompt(a: RealtimePromptConfig | null, b: RealtimePromptConfig | null) {
  if (!a || !b) return false;
  return (
    a.basePrompt === b.basePrompt &&
    a.dominantPrompt === b.dominantPrompt &&
    a.collaborativePrompt === b.collaborativePrompt &&
    a.feedbackConditionId === b.feedbackConditionId &&
    a.feedbackPrompt === b.feedbackPrompt &&
    a.taskCardId === b.taskCardId &&
    a.taskCardPrompt === b.taskCardPrompt
  );
}

function confirmPromptChange(action: string) {
  return window.confirm(
    `${action}\n\n변경된 프롬프트는 현재 진행 중인 세션에는 적용되지 않고, 다음에 새로 생성되는 개별 세션부터 반영됩니다.\n\n계속할까요?`
  );
}

function extractEvaluationOpening(prompt: string) {
  const lines = prompt.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() !== '# opening') continue;
    const openingLines: string[] = [];
    for (const candidate of lines.slice(index + 1)) {
      const stripped = candidate.trim();
      if (stripped.startsWith('#')) break;
      if (stripped) openingLines.push(stripped.replace(/^"|"$/g, ''));
    }
    return openingLines.join(' ').trim() || null;
  }
  return null;
}

function evaluationPromptUrl(evaluationId?: string, versionId?: string, useDefault = false) {
  const params = new URLSearchParams();
  if (evaluationId) params.set('evaluationId', evaluationId);
  if (versionId) params.set('versionId', versionId);
  if (useDefault) params.set('default', '1');
  const query = params.toString();
  return `/api/admin/prompts/evaluation${query ? `?${query}` : ''}`;
}

function practicePromptUrl(versionId?: string, useDefault = false) {
  const params = new URLSearchParams();
  if (versionId) params.set('versionId', versionId);
  if (useDefault) params.set('default', '1');
  const query = params.toString();
  return `/api/admin/prompts/realtime${query ? `?${query}` : ''}`;
}

function isGeneratedVersionLabel(version: PromptVersionSummary) {
  return /^(realtime|evaluation) \d{4}-\d{2}-\d{2}T/.test(version.label);
}

function formatVersionOption(version: PromptVersionSummary, activeVersionId: string | null) {
  const savedAt = new Date(version.createdAt).toLocaleString('ko-KR');
  const customLabel = isGeneratedVersionLabel(version) ? null : version.label.trim();
  return [version.id === activeVersionId ? '활성' : null, savedAt, customLabel]
    .filter(Boolean)
    .join(' · ');
}

export function PromptEditorView({ sessionPurpose }: { sessionPurpose: SessionPurpose }) {
  if (sessionPurpose === 'evaluation') {
    return <EvaluationPromptView />;
  }
  return <PracticePromptEditorView sessionPurpose={sessionPurpose} />;
}

function EvaluationPromptView() {
  const [promptState, setPromptState] = useState<EvaluationPromptResponse | null>(null);
  const [savedPromptState, setSavedPromptState] = useState<EvaluationPromptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');
  const hasChanges = Boolean(
    promptState &&
      savedPromptState &&
      (promptState.evaluationId !== savedPromptState.evaluationId ||
        promptState.prompt !== savedPromptState.prompt)
  );
  const openingSentence = promptState
    ? (extractEvaluationOpening(promptState.prompt) ?? promptState.openingSentence)
    : '';

  const loadPrompt = useCallback(
    async (evaluationId?: string, versionId?: string, useDefault = false) => {
      setLoading(true);
      setMessage(null);
      try {
        const res = await fetch(evaluationPromptUrl(evaluationId, versionId, useDefault), {
          cache: 'no-store',
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage({
            text: data.error ?? 'Evaluation 프롬프트를 불러오지 못했습니다.',
            ok: false,
          });
          setPromptState(null);
          setSavedPromptState(null);
          return;
        }
        setPromptState(data as EvaluationPromptResponse);
        setSavedPromptState(data as EvaluationPromptResponse);
        setVersionLabel('');
      } catch {
        setMessage({ text: 'Evaluation 프롬프트를 불러오지 못했습니다.', ok: false });
        setPromptState(null);
        setSavedPromptState(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadPrompt();
  }, [loadPrompt]);

  async function savePrompt() {
    if (!promptState) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(evaluationPromptUrl(promptState.evaluationId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluationId: promptState.evaluationId,
          prompt: promptState.prompt,
          versionLabel: versionLabel.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? 'Evaluation 프롬프트 저장 실패', ok: false });
        return;
      }
      const saved = data as EvaluationPromptResponse;
      setPromptState(saved);
      setSavedPromptState(saved);
      setSaveDialogOpen(false);
      setVersionLabel('');
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: 'Evaluation 프롬프트 새 버전을 저장했습니다.', ok: true });
    } catch {
      setMessage({ text: 'Evaluation 프롬프트 저장 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function resetPrompt() {
    if (!promptState || !confirmPromptChange('Evaluation 프롬프트를 기본값으로 복원합니다.')) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(evaluationPromptUrl(promptState.evaluationId), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '기본값 복원 실패', ok: false });
        return;
      }
      const restored = data as EvaluationPromptResponse;
      setPromptState(restored);
      setSavedPromptState(restored);
      setVersionLabel('');
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: '기본 Evaluation 프롬프트로 복원했습니다.', ok: true });
    } catch {
      setMessage({ text: '기본값 복원 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function activateVersion() {
    if (!promptState?.promptVersionId) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(evaluationPromptUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', versionId: promptState.promptVersionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '버전 활성화 실패', ok: false });
        return;
      }
      const activated = data as EvaluationPromptResponse;
      setPromptState(activated);
      setSavedPromptState(activated);
      setMessage({ text: 'Evaluation 프롬프트 버전을 활성화했습니다.', ok: true });
    } catch {
      setMessage({ text: '버전 활성화 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function deleteVersion() {
    if (
      !promptState?.promptVersionId ||
      !confirmPromptChange('선택한 Evaluation 프롬프트 버전을 삭제합니다.')
    ) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(evaluationPromptUrl(undefined, promptState.promptVersionId), {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '버전 삭제 실패', ok: false });
        return;
      }
      const next = data as EvaluationPromptResponse;
      setPromptState(next);
      setSavedPromptState(next);
      setMessage({ text: 'Evaluation 프롬프트 버전을 삭제했습니다.', ok: true });
    } catch {
      setMessage({ text: '버전 삭제 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-foreground text-sm font-semibold">Evaluation 프롬프트</h2>
            <p className="text-muted-foreground text-xs">
              자유 대화 평가 세션에서 Kate가 사용하는 manifest 기반 프롬프트입니다.
            </p>
            <p className="text-muted-foreground text-xs">
              운영 설정: {getSessionPurposeLabel('evaluation')}
            </p>
            <p className="text-muted-foreground text-xs">
              {promptState?.usingDefault
                ? '현재 prompts/evaluation/*.md 기본값을 사용합니다.'
                : '현재 prompt_versions 사용자 버전이 md 기본값보다 우선합니다.'}
            </p>
          </div>
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-1 text-xs">
            {promptState?.usingDefault ? '기본값 사용 중' : '사용자 설정 사용 중'}
          </span>
        </div>
        {promptState && (
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              Evaluation ID:{' '}
              <span className="text-foreground font-mono font-semibold">
                {promptState.evaluationId}
              </span>
            </span>
            <span>
              Version:{' '}
              <span className="text-foreground font-semibold">
                {promptState.evaluationPromptVersion ?? '미기록'}
              </span>
            </span>
            <span>
              Character:{' '}
              <span className="text-foreground font-semibold">
                {promptState.evaluationCharacter}
              </span>
            </span>
            <span>
              저장 시각:{' '}
              <span className="text-foreground font-semibold">
                {promptState.savedAt
                  ? new Date(promptState.savedAt).toLocaleString('ko-KR')
                  : '저장 이력 없음'}
              </span>
            </span>
            <span>
              Version ID:{' '}
              <span className="text-foreground font-mono font-semibold">
                {promptState.promptVersionId ?? '기본값'}
              </span>
            </span>
          </div>
        )}
      </section>

      {loading ? (
        <p className="text-muted-foreground text-sm">프롬프트를 불러오는 중...</p>
      ) : promptState ? (
        <>
          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-foreground text-sm font-semibold">Prompt Version</h3>
              <p className="text-muted-foreground text-xs">
                저장된 버전은 immutable snapshot이며, 수정 후 저장하면 새 버전이 생성됩니다.
              </p>
            </div>
            <select
              value={promptState.promptVersionId ?? 'default'}
              disabled={saving}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'default') {
                  loadPrompt(promptState.evaluationId, undefined, true);
                } else {
                  loadPrompt(undefined, value);
                }
              }}
              className="border-input bg-background text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
            >
              <option value="default">기본값</option>
              {promptState.promptVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {formatVersionOption(version, promptState.activePromptVersionId)}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={activateVersion}
                disabled={
                  saving ||
                  !promptState.promptVersionId ||
                  promptState.promptVersionId === promptState.activePromptVersionId
                }
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                이 버전 활성화
              </button>
              <button
                onClick={deleteVersion}
                disabled={saving || !promptState.promptVersionId}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                이 버전 삭제
              </button>
              {promptState.promptVersionHash && (
                <span className="text-muted-foreground font-mono text-xs">
                  hash {promptState.promptVersionHash.slice(0, 12)}
                </span>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            {promptState.evaluations.length > 1 && (
              <select
                value={promptState.evaluationId}
                disabled={saving}
                onChange={(e) => loadPrompt(e.target.value)}
                className="border-input bg-background text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
              >
                {promptState.evaluations.map((evaluation) => (
                  <option key={evaluation.id} value={evaluation.id}>
                    {evaluation.id} · {evaluation.character}
                    {evaluation.version ? ` · ${evaluation.version}` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Opening</h3>
                <p className="text-muted-foreground text-xs">Evaluation 세션 첫 발화입니다.</p>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {openingSentence.length.toLocaleString('ko-KR')}자
              </span>
            </div>
            <textarea
              value={openingSentence}
              rows={2}
              readOnly
              spellCheck={false}
              className="border-input bg-muted/40 text-foreground w-full resize-none rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none"
            />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Prompt Source</h3>
                <p className="text-muted-foreground text-xs">
                  평가 데이터 수집용 자유 대화 프롬프트 전체 내용입니다.
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {promptState.prompt.length.toLocaleString('ko-KR')}자
              </span>
            </div>
            <textarea
              value={promptState.prompt}
              rows={32}
              spellCheck={false}
              onChange={(e) =>
                setPromptState((current) =>
                  current ? { ...current, prompt: e.target.value } : current
                )
              }
              disabled={saving}
              className="border-input bg-background text-foreground focus:ring-primary min-h-96 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 disabled:opacity-50"
            />
          </section>
        </>
      ) : null}

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-destructive'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            setVersionLabel('');
            setSaveDialogOpen(true);
          }}
          disabled={loading || saving || !hasChanges}
        >
          {saving ? '저장 중...' : '새 버전으로 저장'}
        </Button>
        <button
          onClick={resetPrompt}
          disabled={loading || saving || !promptState}
          className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          기본값으로 복원
        </button>
        <button
          onClick={() => setDiscardDialogOpen(true)}
          disabled={loading || saving || !hasChanges}
          className="text-muted-foreground hover:text-foreground px-2 py-2 text-sm underline underline-offset-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          변경 사항 되돌리기
        </button>
        {hasChanges && (
          <span className="text-muted-foreground text-xs">저장되지 않은 변경사항</span>
        )}
        {savedAt && <span className="text-muted-foreground text-xs">마지막 저장: {savedAt}</span>}
      </div>

      {saveDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setSaveDialogOpen(false);
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="evaluation-save-dialog-title"
            className="bg-background text-foreground border-border w-full max-w-md rounded-lg border p-5 shadow-xl"
            onSubmit={(event) => {
              event.preventDefault();
              savePrompt();
            }}
          >
            <div className="flex flex-col gap-1">
              <h3 id="evaluation-save-dialog-title" className="text-base font-semibold">
                새 프롬프트 버전 저장
              </h3>
              <p className="text-muted-foreground text-sm">
                Evaluation 프롬프트의 현재 내용을 immutable snapshot으로 저장합니다.
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="evaluation-version-label">
                버전 이름
              </label>
              <input
                id="evaluation-version-label"
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                disabled={saving}
                autoFocus
                placeholder="비워두면 저장 시각만 표시됩니다"
                className="border-input bg-background text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
              />
            </div>

            <p className="text-muted-foreground mt-4 text-xs leading-5">
              저장된 변경사항은 현재 진행 중인 세션에는 적용되지 않고, 다음에 새로 생성되는 개별
              세션부터 반영됩니다.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveDialogOpen(false)}
                disabled={saving}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                취소
              </button>
              <Button type="submit" disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {discardDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading && !saving) {
              setDiscardDialogOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="evaluation-discard-dialog-title"
            className="bg-background text-foreground border-border w-full max-w-md rounded-lg border p-5 shadow-xl"
          >
            <div className="flex flex-col gap-1">
              <h3 id="evaluation-discard-dialog-title" className="text-base font-semibold">
                변경 사항 되돌리기
              </h3>
              <p className="text-muted-foreground text-sm">
                저장하지 않은 Evaluation 프롬프트 편집 내용이 삭제되고, 마지막으로 화면에 불러온
                프롬프트 상태로 돌아갑니다.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDiscardDialogOpen(false)}
                disabled={loading || saving}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                취소
              </button>
              <Button
                type="button"
                disabled={loading || saving}
                onClick={() => {
                  if (savedPromptState) {
                    setPromptState(savedPromptState);
                    setVersionLabel('');
                    setMessage({ text: '저장되지 않은 변경 사항을 되돌렸습니다.', ok: true });
                  }
                  setDiscardDialogOpen(false);
                }}
              >
                확인
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PracticePromptEditorView({ sessionPurpose }: { sessionPurpose: SessionPurpose }) {
  const [prompt, setPrompt] = useState<RealtimePromptConfig>(EMPTY_PROMPT);
  const [savedPrompt, setSavedPrompt] = useState<RealtimePromptConfig | null>(null);
  const [selectedAgentRole, setSelectedAgentRole] = useState<AgentRole>('dominant');
  const [usingDefault, setUsingDefault] = useState(false);
  const [promptId, setPromptId] = useState('default');
  const [promptSavedAt, setPromptSavedAt] = useState<string | null>(null);
  const [activePromptVersionId, setActivePromptVersionId] = useState<string | null>(null);
  const [promptVersionId, setPromptVersionId] = useState<string | null>(null);
  const [promptVersionLabel, setPromptVersionLabel] = useState<string | null>(null);
  const [promptVersionHash, setPromptVersionHash] = useState<string | null>(null);
  const [promptVersions, setPromptVersions] = useState<PromptVersionSummary[]>([]);
  const [feedbackConditions, setFeedbackConditions] = useState<RealtimeFeedbackConditionSummary[]>(
    []
  );
  const [taskCards, setTaskCards] = useState<RealtimeTaskCardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');

  const hasChanges = useMemo(() => !samePrompt(prompt, savedPrompt), [prompt, savedPrompt]);
  const selectedRolePromptKey: PromptField =
    selectedAgentRole === 'collaborative' ? 'collaborativePrompt' : 'dominantPrompt';
  const selectedRoleLabel = getAgentRoleLabel(selectedAgentRole);
  const selectedFeedbackCondition = useMemo(
    () =>
      feedbackConditions.find((condition) => condition.id === prompt.feedbackConditionId) ?? null,
    [feedbackConditions, prompt.feedbackConditionId]
  );
  const visiblePromptGroups = useMemo(
    () =>
      PROMPT_GROUPS.map((group) =>
        group.title === 'Interlocutor Role Prompt'
          ? {
              ...group,
              description: `운영 설정에서 선택된 ${selectedRoleLabel} 에이전트 역할 규칙입니다.`,
              fields: group.fields.filter((field) => field.key === selectedRolePromptKey),
            }
          : group.title === 'Feedback Condition Prompt'
            ? {
                ...group,
                description: selectedFeedbackCondition
                  ? `운영 설정에서 선택된 ${selectedFeedbackCondition.title} (${selectedFeedbackCondition.id}) 조건 규칙입니다.`
                  : group.description,
              }
            : group
      ),
    [selectedFeedbackCondition, selectedRoleLabel, selectedRolePromptKey]
  );

  function formatPromptSavedAt(value: string | null) {
    return value ? new Date(value).toLocaleString('ko-KR') : '저장 이력 없음';
  }

  function applyPromptResponse(data: PromptResponse) {
    const next = promptConfigFromResponse(data);
    setPrompt(next);
    setSavedPrompt(next);
    setFeedbackConditions(data.feedbackConditions);
    setTaskCards(data.taskCards);
    setUsingDefault(data.usingDefault);
    setPromptId(data.promptId);
    setPromptSavedAt(data.savedAt);
    setActivePromptVersionId(data.activePromptVersionId);
    setPromptVersionId(data.promptVersionId);
    setPromptVersionLabel(data.promptVersionLabel);
    setPromptVersionHash(data.promptVersionHash);
    setPromptVersions(data.promptVersions);
    setVersionLabel('');
  }

  function renderPromptTextarea(field: PromptFieldConfig) {
    return (
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
    );
  }

  const loadPrompt = useCallback(async (versionId?: string, useDefault = false) => {
    setLoading(true);
    setMessage(null);
    try {
      const [res, settingsRes] = await Promise.all([
        fetch(practicePromptUrl(versionId, useDefault), { cache: 'no-store' }),
        fetch('/api/admin/config', { cache: 'no-store' }),
      ]);
      const data: PromptResponse = await res.json();
      const settings: RuntimeSettingsResponse = await settingsRes.json();
      if (!res.ok) {
        setMessage({
          text: (data as { error?: string }).error ?? '프롬프트를 불러오지 못했습니다.',
          ok: false,
        });
        return;
      }
      applyPromptResponse(data);
      setSelectedAgentRole(normalizeAgentRole(settings.agentRole));
    } catch {
      setMessage({ text: '프롬프트를 불러오지 못했습니다.', ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompt();
  }, [loadPrompt]);

  async function savePrompt() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/prompts/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...prompt,
          versionLabel: versionLabel.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '프롬프트 저장 실패', ok: false });
        return;
      }
      const saved: PromptResponse = data;
      applyPromptResponse(saved);
      setSaveDialogOpen(false);
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: 'Practice 프롬프트 새 버전을 저장했습니다.', ok: true });
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
      applyPromptResponse(saved);
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: '기본 프롬프트로 복원했습니다.', ok: true });
    } catch {
      setMessage({ text: '기본값 복원 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function activateVersion() {
    if (!promptVersionId) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/prompts/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', versionId: promptVersionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '버전 활성화 실패', ok: false });
        return;
      }
      applyPromptResponse(data as PromptResponse);
      setMessage({ text: 'Practice 프롬프트 버전을 활성화했습니다.', ok: true });
    } catch {
      setMessage({ text: '버전 활성화 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function deleteVersion() {
    if (!promptVersionId || !confirmPromptChange('선택한 Practice 프롬프트 버전을 삭제합니다.')) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(practicePromptUrl(promptVersionId), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '버전 삭제 실패', ok: false });
        return;
      }
      applyPromptResponse(data as PromptResponse);
      setMessage({ text: 'Practice 프롬프트 버전을 삭제했습니다.', ok: true });
    } catch {
      setMessage({ text: '버전 삭제 중 오류가 발생했습니다.', ok: false });
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
            <p className="text-muted-foreground text-xs">
              운영 설정: {getSessionPurposeLabel(sessionPurpose)}
            </p>
            <p className="text-muted-foreground text-xs">
              {usingDefault
                ? '현재 prompts/realtime/*.md 기본값을 사용합니다.'
                : '현재 Supabase active prompt version이 md 기본값보다 우선합니다.'}
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
            Version ID:{' '}
            <span className="text-foreground font-mono font-semibold">
              {promptVersionId ?? '기본값'}
            </span>
          </span>
          <span>
            저장 시각:{' '}
            <span className="text-foreground font-semibold">
              {formatPromptSavedAt(promptSavedAt)}
            </span>
          </span>
          {promptVersionLabel && (
            <span>
              버전 이름: <span className="text-foreground font-semibold">{promptVersionLabel}</span>
            </span>
          )}
          <span>
            운영 조합:{' '}
            <span className="text-foreground font-semibold">
              {selectedRoleLabel}
              {selectedFeedbackCondition ? ` + ${selectedFeedbackCondition.title}` : ''}
            </span>
          </span>
        </div>
      </section>

      {loading ? (
        <p className="text-muted-foreground text-sm">프롬프트를 불러오는 중...</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-foreground text-sm font-semibold">Prompt Version</h3>
              <p className="text-muted-foreground text-xs">
                저장된 버전은 immutable snapshot이며, 수정 후 저장하면 새 버전이 생성됩니다.
              </p>
            </div>
            <select
              value={promptVersionId ?? 'default'}
              disabled={saving}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'default') {
                  loadPrompt(undefined, true);
                } else {
                  loadPrompt(value);
                }
              }}
              className="border-input bg-background text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
            >
              <option value="default">기본값</option>
              {promptVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {formatVersionOption(version, activePromptVersionId)}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={activateVersion}
                disabled={saving || !promptVersionId || promptVersionId === activePromptVersionId}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                이 버전 활성화
              </button>
              <button
                onClick={deleteVersion}
                disabled={saving || !promptVersionId}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                이 버전 삭제
              </button>
              {promptVersionHash && (
                <span className="text-muted-foreground font-mono text-xs">
                  hash {promptVersionHash.slice(0, 12)}
                </span>
              )}
            </div>
          </section>

          {visiblePromptGroups.map((group) => {
            const singleField = group.fields.length === 1 ? group.fields[0] : null;

            return (
              <section key={group.title} className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h3 className="text-foreground text-sm font-semibold">{group.title}</h3>
                    <p className="text-muted-foreground text-xs">{group.description}</p>
                  </div>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {group.fields
                      .reduce((total, field) => total + prompt[field.key].length, 0)
                      .toLocaleString('ko-KR')}
                    자
                  </span>
                </div>
                {singleField ? (
                  renderPromptTextarea(singleField)
                ) : (
                  <div className="flex flex-col gap-4">
                    {group.fields.map((field) => (
                      <div
                        key={field.key}
                        className="border-border flex flex-col gap-2 border-l pl-4"
                      >
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <h4 className="text-foreground text-xs font-semibold">{field.title}</h4>
                            <p className="text-muted-foreground text-xs">{field.description}</p>
                          </div>
                          <span className="text-muted-foreground shrink-0 font-mono text-xs">
                            {prompt[field.key].length.toLocaleString('ko-KR')}자
                          </span>
                        </div>
                        {renderPromptTextarea(field)}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-foreground text-sm font-semibold">Task Card</h3>
                <p className="text-muted-foreground text-xs">
                  개별 세션에 적용할 주제별 과업 카드를 선택합니다.
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {prompt.taskCardPrompt.length.toLocaleString('ko-KR')}자
              </span>
            </div>
            <select
              value={prompt.taskCardId}
              disabled={saving}
              onChange={(e) => {
                const selected = taskCards.find((taskCard) => taskCard.id === e.target.value);
                setPrompt((current) => ({
                  ...current,
                  taskCardId: e.target.value,
                  taskCardPrompt: selected?.prompt ?? current.taskCardPrompt,
                }));
              }}
              className="border-input bg-background text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
            >
              {taskCards.map((taskCard) => (
                <option key={taskCard.id} value={taskCard.id}>
                  {taskCard.title}
                  {taskCard.level ? ` · ${taskCard.level}` : ''}
                </option>
              ))}
            </select>
            <textarea
              value={prompt.taskCardPrompt}
              rows={18}
              spellCheck={false}
              onChange={(e) =>
                setPrompt((current) => ({
                  ...current,
                  taskCardPrompt: e.target.value,
                }))
              }
              disabled={saving}
              className="border-input bg-background text-foreground focus:ring-primary min-h-32 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 disabled:opacity-50"
            />
            {selectedFeedbackCondition && (
              <p className="text-muted-foreground text-xs">
                운영 설정의 조합 기준:{' '}
                <span className="text-foreground font-semibold">
                  {selectedRoleLabel} + {selectedFeedbackCondition.title}
                </span>
              </p>
            )}
          </section>
        </>
      )}

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-destructive'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            setVersionLabel('');
            setSaveDialogOpen(true);
          }}
          disabled={loading || saving || !hasChanges}
        >
          {saving ? '저장 중...' : '새 버전으로 저장'}
        </Button>
        <button
          onClick={resetPrompt}
          disabled={loading || saving}
          className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          기본값으로 복원
        </button>
        <button
          onClick={() => setDiscardDialogOpen(true)}
          disabled={loading || saving || !hasChanges}
          className="text-muted-foreground hover:text-foreground px-2 py-2 text-sm underline underline-offset-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          변경 사항 되돌리기
        </button>
        {hasChanges && (
          <span className="text-muted-foreground text-xs">저장되지 않은 변경사항</span>
        )}
        {savedAt && <span className="text-muted-foreground text-xs">마지막 저장: {savedAt}</span>}
      </div>

      {saveDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setSaveDialogOpen(false);
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-save-dialog-title"
            className="bg-background text-foreground border-border w-full max-w-md rounded-lg border p-5 shadow-xl"
            onSubmit={(event) => {
              event.preventDefault();
              savePrompt();
            }}
          >
            <div className="flex flex-col gap-1">
              <h3 id="practice-save-dialog-title" className="text-base font-semibold">
                새 프롬프트 버전 저장
              </h3>
              <p className="text-muted-foreground text-sm">
                Practice 프롬프트의 현재 내용을 immutable snapshot으로 저장합니다.
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="practice-version-label">
                버전 이름
              </label>
              <input
                id="practice-version-label"
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                disabled={saving}
                autoFocus
                placeholder="비워두면 저장 시각만 표시됩니다"
                className="border-input bg-background text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-50"
              />
            </div>

            <p className="text-muted-foreground mt-4 text-xs leading-5">
              저장된 변경사항은 현재 진행 중인 세션에는 적용되지 않고, 다음에 새로 생성되는 개별
              세션부터 반영됩니다.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveDialogOpen(false)}
                disabled={saving}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                취소
              </button>
              <Button type="submit" disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {discardDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading && !saving) {
              setDiscardDialogOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-discard-dialog-title"
            className="bg-background text-foreground border-border w-full max-w-md rounded-lg border p-5 shadow-xl"
          >
            <div className="flex flex-col gap-1">
              <h3 id="practice-discard-dialog-title" className="text-base font-semibold">
                변경 사항 되돌리기
              </h3>
              <p className="text-muted-foreground text-sm">
                저장하지 않은 Practice 프롬프트 편집 내용이 삭제되고, 마지막으로 화면에 불러온
                프롬프트 상태로 돌아갑니다.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDiscardDialogOpen(false)}
                disabled={loading || saving}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                취소
              </button>
              <Button
                type="button"
                disabled={loading || saving}
                onClick={() => {
                  if (savedPrompt) {
                    setPrompt(savedPrompt);
                    setVersionLabel('');
                    setMessage({ text: '저장되지 않은 변경 사항을 되돌렸습니다.', ok: true });
                  }
                  setDiscardDialogOpen(false);
                }}
              >
                확인
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
