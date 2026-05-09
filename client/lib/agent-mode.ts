export type AgentMode = 'pipeline' | 'realtime';

export const PIPELINE_AGENT_NAME = 'pipeline-agent';
export const REALTIME_AGENT_NAME = 'realtime-agent';

export function normalizeAgentMode(value: unknown): AgentMode {
  return value === 'realtime' ? 'realtime' : 'pipeline';
}

export function getAgentNameForMode(mode: AgentMode): string {
  return mode === 'realtime' ? REALTIME_AGENT_NAME : PIPELINE_AGENT_NAME;
}

export function getAgentModeLabel(mode: AgentMode): string {
  return mode === 'realtime' ? '개별 대화 모드' : '그룹 대화 모드';
}
