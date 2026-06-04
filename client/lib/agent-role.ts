import { type AgentMode, PIPELINE_AGENT_NAME } from '@/lib/agent-mode';

export type AgentRole = 'dominant' | 'collaborative';

export const DEFAULT_AGENT_ROLE: AgentRole = 'dominant';
export const REALTIME_AGENT_NAME = 'realtime-agent';
export const REALTIME_DOMINANT_AGENT_NAME = REALTIME_AGENT_NAME;
export const REALTIME_COLLABORATIVE_AGENT_NAME = REALTIME_AGENT_NAME;

export function normalizeAgentRole(value: unknown): AgentRole {
  return value === 'collaborative' || value === 'passive' ? 'collaborative' : DEFAULT_AGENT_ROLE;
}

export function getAgentRoleLabel(role: AgentRole): string {
  return role === 'collaborative' ? '협력적' : '주도적';
}

export function getRealtimeAgentNameForRole(role: AgentRole): string {
  void role;
  return REALTIME_AGENT_NAME;
}

export function getAgentNameForConfig(mode: AgentMode, role: AgentRole): string {
  return mode === 'realtime' ? getRealtimeAgentNameForRole(role) : PIPELINE_AGENT_NAME;
}
