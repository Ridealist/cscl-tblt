import { type AgentMode, PIPELINE_AGENT_NAME } from '@/lib/agent-mode';

export type AgentStance = 'dominant' | 'passive';

export const DEFAULT_AGENT_STANCE: AgentStance = 'dominant';
export const REALTIME_AGENT_NAME = 'realtime-agent';
export const REALTIME_DOMINANT_AGENT_NAME = REALTIME_AGENT_NAME;
export const REALTIME_PASSIVE_AGENT_NAME = REALTIME_AGENT_NAME;

export function normalizeAgentStance(value: unknown): AgentStance {
  return value === 'passive' ? 'passive' : DEFAULT_AGENT_STANCE;
}

export function getAgentStanceLabel(stance: AgentStance): string {
  return stance === 'passive' ? '수동적' : '주도적';
}

export function getRealtimeAgentNameForStance(stance: AgentStance): string {
  void stance;
  return REALTIME_AGENT_NAME;
}

export function getAgentNameForConfig(mode: AgentMode, stance: AgentStance): string {
  return mode === 'realtime' ? getRealtimeAgentNameForStance(stance) : PIPELINE_AGENT_NAME;
}
