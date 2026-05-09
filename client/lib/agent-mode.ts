export type AgentMode = 'pipeline' | 'realtime';

export const PIPELINE_AGENT_NAME = 'pipeline-agent';

export function normalizeAgentMode(value: unknown): AgentMode {
  return value === 'realtime' ? 'realtime' : 'pipeline';
}

export function getAgentModeLabel(mode: AgentMode): string {
  return mode === 'realtime' ? '개별 대화 모드' : '그룹 대화 모드';
}
