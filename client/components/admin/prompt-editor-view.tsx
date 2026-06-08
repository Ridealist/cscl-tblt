'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type AgentRole, getAgentRoleLabel, normalizeAgentRole } from '@/lib/agent-role';
import type {
  RealtimeFeedbackConditionSummary,
  RealtimePromptConfig,
  RealtimePromptState,
  RealtimeTaskCardSummary,
} from '@/lib/realtime-prompt-config';

type PromptField = keyof RealtimePromptConfig;

type PromptResponse = RealtimePromptState;
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

export function PromptEditorView() {
  const [prompt, setPrompt] = useState<RealtimePromptConfig>(EMPTY_PROMPT);
  const [savedPrompt, setSavedPrompt] = useState<RealtimePromptConfig | null>(null);
  const [selectedAgentRole, setSelectedAgentRole] = useState<AgentRole>('dominant');
  const [usingDefault, setUsingDefault] = useState(false);
  const [promptId, setPromptId] = useState('default');
  const [promptSavedAt, setPromptSavedAt] = useState<string | null>(null);
  const [feedbackConditions, setFeedbackConditions] = useState<RealtimeFeedbackConditionSummary[]>(
    []
  );
  const [taskCards, setTaskCards] = useState<RealtimeTaskCardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);

  const hasChanges = useMemo(() => !samePrompt(prompt, savedPrompt), [prompt, savedPrompt]);
  const selectedRolePromptKey: PromptField =
    selectedAgentRole === 'collaborative' ? 'collaborativePrompt' : 'dominantPrompt';
  const selectedRoleLabel = getAgentRoleLabel(selectedAgentRole);
  const visiblePromptGroups = useMemo(
    () =>
      PROMPT_GROUPS.map((group) =>
        group.title === 'Interlocutor Role Prompt'
          ? {
              ...group,
              description: `운영 설정에서 선택된 ${selectedRoleLabel} 에이전트 역할 규칙입니다.`,
              fields: group.fields.filter((field) => field.key === selectedRolePromptKey),
            }
          : group
      ),
    [selectedRoleLabel, selectedRolePromptKey]
  );
  const selectedTaskCard = useMemo(
    () => taskCards.find((taskCard) => taskCard.id === prompt.taskCardId) ?? null,
    [prompt.taskCardId, taskCards]
  );
  const selectedFeedbackCondition = useMemo(
    () =>
      feedbackConditions.find((condition) => condition.id === prompt.feedbackConditionId) ?? null,
    [feedbackConditions, prompt.feedbackConditionId]
  );
  const feedbackConditionTitles = useMemo(
    () => new Map(feedbackConditions.map((condition) => [condition.id, condition.title])),
    [feedbackConditions]
  );
  const exampleEntries = useMemo(() => {
    const examples = selectedTaskCard?.examples;
    if (!examples) return [];
    const roleExamples = examples[selectedAgentRole];
    if (!roleExamples) return [];
    const example = roleExamples[prompt.feedbackConditionId] ?? roleExamples.default;
    if (!example) return [];
    const feedbackConditionTitle =
      feedbackConditionTitles.get(prompt.feedbackConditionId) ?? prompt.feedbackConditionId;
    return [
      {
        key: `${selectedAgentRole}.${prompt.feedbackConditionId}`,
        title: `${selectedRoleLabel} + ${feedbackConditionTitle}`,
        value: example.prompt,
      },
    ];
  }, [
    feedbackConditionTitles,
    prompt.feedbackConditionId,
    selectedAgentRole,
    selectedRoleLabel,
    selectedTaskCard,
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

  async function loadPrompt() {
    setLoading(true);
    setMessage(null);
    try {
      const [res, settingsRes] = await Promise.all([
        fetch('/api/admin/prompts/realtime', { cache: 'no-store' }),
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
      });
      setSavedPrompt({
        basePrompt: data.basePrompt,
        dominantPrompt: data.dominantPrompt,
        collaborativePrompt: data.collaborativePrompt,
        feedbackConditionId: data.feedbackConditionId,
        feedbackPrompt: data.feedbackPrompt,
        taskCardId: data.taskCardId,
        taskCardPrompt: data.taskCardPrompt,
      });
      setFeedbackConditions(data.feedbackConditions);
      setTaskCards(data.taskCards);
      setUsingDefault(data.usingDefault);
      setPromptId(data.promptId);
      setPromptSavedAt(data.savedAt);
      setSelectedAgentRole(normalizeAgentRole(settings.agentRole));
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
        feedbackConditionId: saved.feedbackConditionId,
        feedbackPrompt: saved.feedbackPrompt,
        taskCardId: saved.taskCardId,
        taskCardPrompt: saved.taskCardPrompt,
      };
      setPrompt(next);
      setSavedPrompt(next);
      setFeedbackConditions(saved.feedbackConditions);
      setTaskCards(saved.taskCards);
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
        feedbackConditionId: saved.feedbackConditionId,
        feedbackPrompt: saved.feedbackPrompt,
        taskCardId: saved.taskCardId,
        taskCardPrompt: saved.taskCardPrompt,
      };
      setPrompt(next);
      setSavedPrompt(next);
      setFeedbackConditions(saved.feedbackConditions);
      setTaskCards(saved.taskCards);
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
            <p className="text-muted-foreground text-xs">
              {usingDefault
                ? '현재 prompts/realtime/*.md 기본값을 사용합니다.'
                : '현재 prompt_config.json 사용자 설정이 md 기본값보다 우선합니다.'}
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
              readOnly
              spellCheck={false}
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
                        readOnly
                        spellCheck={false}
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
