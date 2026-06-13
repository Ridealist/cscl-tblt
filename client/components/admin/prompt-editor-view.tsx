'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type AgentRole, getAgentRoleLabel, normalizeAgentRole } from '@/lib/agent-role';
import type { PromptVersionSummary } from '@/lib/prompt-version-store';
import type {
  RealtimeFeedbackConditionSummary,
  RealtimeFeedbackExamples,
  RealtimePromptConfig,
  RealtimePromptState,
  RealtimeTaskCardSummary,
} from '@/lib/realtime-prompt-config';
import { type SessionPurpose, getSessionPurposeLabel } from '@/lib/session-activity';

type PromptField = 'basePrompt' | 'dominantPrompt' | 'collaborativePrompt' | 'feedbackPrompt';

type PromptResponse = RealtimePromptState;
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
  conversationExamplePrompts: {},
};

function sameTextMap(a: Record<string, string>, b: Record<string, string>) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key])
  );
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
    a.taskCardPrompt === b.taskCardPrompt &&
    sameTextMap(a.conversationExamplePrompts, b.conversationExamplePrompts)
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

function realtimePromptUrl(versionId?: string, useDefault = false) {
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

function getTaskCardExamplePrompts(taskCard: RealtimeTaskCardSummary | null) {
  const prompts: Record<string, string> = {};
  if (!taskCard?.examples) return prompts;

  for (const role of ['dominant', 'collaborative'] as const) {
    const roleExamples: RealtimeFeedbackExamples | undefined = taskCard.examples[role];
    if (!roleExamples) continue;
    for (const [feedbackConditionId, example] of Object.entries(roleExamples)) {
      const key = feedbackConditionId === 'default' ? role : `${role}.${feedbackConditionId}`;
      prompts[key] = example.prompt;
    }
  }

  return prompts;
}

function VersionSaveDialog({
  disabled,
  onCancel,
  onSubmit,
  open,
  promptName,
}: {
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (versionLabel?: string) => void;
  open: boolean;
  promptName: string;
}) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (open) setLabel('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="presentation"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(label.trim() || undefined);
        }}
        className="bg-background border-border text-foreground w-full max-w-md rounded-lg border p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-version-save-title"
      >
        <div className="flex flex-col gap-1">
          <h2 id="prompt-version-save-title" className="text-base font-semibold">
            새 프롬프트 버전 저장
          </h2>
          <p className="text-muted-foreground text-sm">
            {promptName}의 현재 내용을 immutable snapshot으로 저장합니다.
          </p>
        </div>
        <label className="mt-4 flex flex-col gap-2 text-sm font-medium">
          버전 이름
          <input
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={disabled}
            placeholder="비워두면 저장 시각만 표시됩니다"
            className="border-input bg-background text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 text-sm font-normal outline-none focus:ring-2 disabled:opacity-50"
          />
        </label>
        <p className="text-muted-foreground mt-3 text-xs">
          저장된 변경사항은 현재 진행 중인 세션에는 적용되지 않고, 다음에 새로 생성되는 개별
          세션부터 반영됩니다.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            취소
          </button>
          <Button type="submit" disabled={disabled}>
            {disabled ? '저장 중...' : '저장'}
          </Button>
        </div>
      </form>
    </div>
  );
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
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
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

  async function savePrompt(versionLabel?: string) {
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
          versionLabel,
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
      setVersionDialogOpen(false);
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: 'Evaluation 프롬프트 새 버전을 저장했습니다.', ok: true });
    } catch {
      setMessage({ text: 'Evaluation 프롬프트 저장 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function resetPrompt() {
    if (!promptState || !confirmPromptChange('Evaluation 프롬프트를 기본값으로 불러옵니다.')) {
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
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: '기본 Evaluation 프롬프트를 불러왔습니다.', ok: true });
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
      <VersionSaveDialog
        disabled={saving}
        onCancel={() => setVersionDialogOpen(false)}
        onSubmit={savePrompt}
        open={versionDialogOpen}
        promptName="Evaluation 프롬프트"
      />
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-foreground text-sm font-semibold">Evaluation 프롬프트</h2>
            <p className="text-muted-foreground text-xs">
              자유 대화 평가 세션에서 사용하는 manifest 기반 프롬프트입니다.
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
            <div>
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
            </div>
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
              className="border-input bg-muted/40 text-foreground min-h-96 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none"
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
          onClick={() => setVersionDialogOpen(true)}
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
        {hasChanges && (
          <span className="text-muted-foreground text-xs">저장되지 않은 변경사항</span>
        )}
        {savedAt && <span className="text-muted-foreground text-xs">마지막 저장: {savedAt}</span>}
      </div>
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
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);

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
  const feedbackConditionTitles = useMemo(
    () => new Map(feedbackConditions.map((condition) => [condition.id, condition.title])),
    [feedbackConditions]
  );
  const exampleEntries = useMemo(() => {
    const currentKey = `${selectedAgentRole}.${prompt.feedbackConditionId}`;
    return Object.entries(prompt.conversationExamplePrompts)
      .map(([key, value]) => {
        const [role, feedbackConditionId = 'default'] = key.split('.');
        const roleLabel =
          role === 'collaborative'
            ? getAgentRoleLabel('collaborative')
            : getAgentRoleLabel('dominant');
        const feedbackConditionTitle =
          feedbackConditionId === 'default'
            ? 'Default'
            : (feedbackConditionTitles.get(feedbackConditionId) ?? feedbackConditionId);
        return {
          key,
          title: `${roleLabel} + ${feedbackConditionTitle}`,
          value,
          active: key === currentKey,
        };
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || a.key.localeCompare(b.key));
  }, [
    feedbackConditionTitles,
    prompt.conversationExamplePrompts,
    prompt.feedbackConditionId,
    selectedAgentRole,
  ]);

  function formatPromptSavedAt(value: string | null) {
    return value ? new Date(value).toLocaleString('ko-KR') : '저장 이력 없음';
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
        fetch(realtimePromptUrl(versionId, useDefault), { cache: 'no-store' }),
        fetch('/api/admin/config', { cache: 'no-store' }),
      ]);
      const data: PromptResponse = await res.json();
      const settings: RuntimeSettingsResponse = await settingsRes.json();
      setPrompt({
        basePrompt: data.basePrompt,
        dominantPrompt: data.dominantPrompt,
        collaborativePrompt: data.collaborativePrompt,
        feedbackConditionId: data.feedbackConditionId,
        feedbackPrompt: data.feedbackPrompt,
        taskCardId: data.taskCardId,
        taskCardPrompt: data.taskCardPrompt,
        conversationExamplePrompts: data.conversationExamplePrompts,
      });
      setSavedPrompt({
        basePrompt: data.basePrompt,
        dominantPrompt: data.dominantPrompt,
        collaborativePrompt: data.collaborativePrompt,
        feedbackConditionId: data.feedbackConditionId,
        feedbackPrompt: data.feedbackPrompt,
        taskCardId: data.taskCardId,
        taskCardPrompt: data.taskCardPrompt,
        conversationExamplePrompts: data.conversationExamplePrompts,
      });
      setFeedbackConditions(data.feedbackConditions);
      setTaskCards(data.taskCards);
      setUsingDefault(data.usingDefault);
      setPromptId(data.promptId);
      setPromptSavedAt(data.savedAt);
      setActivePromptVersionId(data.activePromptVersionId);
      setPromptVersionHash(data.promptVersionHash);
      setPromptVersions(data.promptVersions);
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

  async function savePrompt(versionLabel?: string) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/prompts/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prompt, versionLabel }),
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
        feedbackConditionId: saved.feedbackConditionId,
        feedbackPrompt: saved.feedbackPrompt,
        taskCardId: saved.taskCardId,
        taskCardPrompt: saved.taskCardPrompt,
        conversationExamplePrompts: saved.conversationExamplePrompts,
      };
      setPrompt(next);
      setSavedPrompt(next);
      setFeedbackConditions(saved.feedbackConditions);
      setTaskCards(saved.taskCards);
      setUsingDefault(saved.usingDefault);
      setPromptId(saved.promptId);
      setPromptSavedAt(saved.savedAt);
      setActivePromptVersionId(saved.activePromptVersionId);
      setPromptVersionHash(saved.promptVersionHash);
      setPromptVersions(saved.promptVersions);
      setVersionDialogOpen(false);
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: 'Realtime 프롬프트 새 버전을 저장했습니다.', ok: true });
    } catch {
      setMessage({ text: '프롬프트 저장 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function resetPrompt() {
    if (!confirmPromptChange('Realtime 프롬프트를 기본값으로 불러옵니다.')) return;

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
        feedbackConditionId: saved.feedbackConditionId,
        feedbackPrompt: saved.feedbackPrompt,
        taskCardId: saved.taskCardId,
        taskCardPrompt: saved.taskCardPrompt,
        conversationExamplePrompts: saved.conversationExamplePrompts,
      };
      setPrompt(next);
      setSavedPrompt(next);
      setFeedbackConditions(saved.feedbackConditions);
      setTaskCards(saved.taskCards);
      setUsingDefault(saved.usingDefault);
      setPromptId(saved.promptId);
      setPromptSavedAt(saved.savedAt);
      setActivePromptVersionId(saved.activePromptVersionId);
      setPromptVersionHash(saved.promptVersionHash);
      setPromptVersions(saved.promptVersions);
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      setMessage({ text: '기본 Realtime 프롬프트를 불러왔습니다.', ok: true });
    } catch {
      setMessage({ text: '기본값 복원 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  function applyRealtimePromptState(state: PromptResponse) {
    const next = {
      basePrompt: state.basePrompt,
      dominantPrompt: state.dominantPrompt,
      collaborativePrompt: state.collaborativePrompt,
      feedbackConditionId: state.feedbackConditionId,
      feedbackPrompt: state.feedbackPrompt,
      taskCardId: state.taskCardId,
      taskCardPrompt: state.taskCardPrompt,
      conversationExamplePrompts: state.conversationExamplePrompts,
    };
    setPrompt(next);
    setSavedPrompt(next);
    setFeedbackConditions(state.feedbackConditions);
    setTaskCards(state.taskCards);
    setUsingDefault(state.usingDefault);
    setPromptId(state.promptId);
    setPromptSavedAt(state.savedAt);
    setActivePromptVersionId(state.activePromptVersionId);
    setPromptVersionHash(state.promptVersionHash);
    setPromptVersions(state.promptVersions);
  }

  async function activateVersion() {
    if (!promptId || promptId === 'default') return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/prompts/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', versionId: promptId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '버전 활성화 실패', ok: false });
        return;
      }
      applyRealtimePromptState(data as PromptResponse);
      setMessage({ text: 'Realtime 프롬프트 버전을 활성화했습니다.', ok: true });
    } catch {
      setMessage({ text: '버전 활성화 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function deleteVersion() {
    if (
      !promptId ||
      promptId === 'default' ||
      !confirmPromptChange('선택한 Realtime 프롬프트 버전을 삭제합니다.')
    ) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(realtimePromptUrl(promptId), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? '버전 삭제 실패', ok: false });
        return;
      }
      applyRealtimePromptState(data as PromptResponse);
      setMessage({ text: 'Realtime 프롬프트 버전을 삭제했습니다.', ok: true });
    } catch {
      setMessage({ text: '버전 삭제 중 오류가 발생했습니다.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <VersionSaveDialog
        disabled={saving}
        onCancel={() => setVersionDialogOpen(false)}
        onSubmit={savePrompt}
        open={versionDialogOpen}
        promptName="Realtime 프롬프트"
      />
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
                : '현재 prompt_versions 사용자 버전이 md 기본값보다 우선합니다.'}
            </p>
          </div>
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-1 text-xs">
            {usingDefault ? '기본값 사용 중' : '사용자 설정 사용 중'}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            Version ID:{' '}
            <span className="text-foreground font-mono font-semibold">
              {promptId === 'default' ? '기본값' : promptId}
            </span>
          </span>
          <span>
            저장 시각:{' '}
            <span className="text-foreground font-semibold">
              {formatPromptSavedAt(promptSavedAt)}
            </span>
          </span>
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
            <div>
              <select
                value={promptId === 'default' ? 'default' : promptId}
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={activateVersion}
                disabled={saving || promptId === 'default' || promptId === activePromptVersionId}
                className="border-border hover:bg-muted text-foreground rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                이 버전 활성화
              </button>
              <button
                onClick={deleteVersion}
                disabled={saving || promptId === 'default'}
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
                setExamplesOpen(false);
                setPrompt((current) => ({
                  ...current,
                  taskCardId: e.target.value,
                  taskCardPrompt: selected?.prompt ?? current.taskCardPrompt,
                  conversationExamplePrompts: getTaskCardExamplePrompts(selected ?? null),
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
              className="border-input bg-muted/40 text-foreground min-h-32 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none"
            />
            <div className="border-border flex flex-col gap-3 border-t pt-3">
              <button
                type="button"
                onClick={() => setExamplesOpen((open) => !open)}
                disabled={exampleEntries.length === 0}
                className="text-foreground enabled:hover:bg-muted flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm font-semibold transition-colors disabled:cursor-default disabled:opacity-60"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {examplesOpen ? (
                    <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>Conversation Examples</span>
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {exampleEntries.length > 0
                    ? `${exampleEntries.length}개`
                    : '등록된 examples 없음'}
                </span>
              </button>
              {selectedFeedbackCondition && (
                <p className="text-muted-foreground px-1 text-xs">
                  운영 설정의 조합 기준:{' '}
                  <span className="text-foreground font-semibold">
                    {selectedRoleLabel} + {selectedFeedbackCondition.title}
                  </span>
                </p>
              )}

              {examplesOpen && exampleEntries.length > 0 && (
                <div className="flex flex-col gap-4">
                  {exampleEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="border-border flex flex-col gap-2 border-l pl-4"
                    >
                      <div className="flex items-end justify-between gap-3">
                        <h4 className="text-foreground text-xs font-semibold">{entry.title}</h4>
                        <span className="text-muted-foreground shrink-0 font-mono text-xs">
                          {entry.value.length.toLocaleString('ko-KR')}자
                        </span>
                      </div>
                      <textarea
                        value={entry.value}
                        rows={18}
                        spellCheck={false}
                        onChange={(e) =>
                          setPrompt((current) => ({
                            ...current,
                            conversationExamplePrompts: {
                              ...current.conversationExamplePrompts,
                              [entry.key]: e.target.value,
                            },
                          }))
                        }
                        disabled={saving}
                        className="border-input bg-muted/40 text-foreground min-h-32 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
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
          onClick={() => setVersionDialogOpen(true)}
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
        {hasChanges && (
          <span className="text-muted-foreground text-xs">저장되지 않은 변경사항</span>
        )}
        {savedAt && <span className="text-muted-foreground text-xs">마지막 저장: {savedAt}</span>}
      </div>
    </div>
  );
}
