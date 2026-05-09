import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { type AgentMode, normalizeAgentMode } from '@/lib/agent-mode';
import { type AgentStance, DEFAULT_AGENT_STANCE, normalizeAgentStance } from '@/lib/agent-stance';

const CONFIG_PATH = join(process.cwd(), '..', 'config.json');

interface AppSettings {
  numClasses: number;
  numGroupsPerClass: number;
  classStart: number;
  activeClass: number;
  agentMode: AgentMode;
  agentStance: AgentStance;
  realtimeResetting: boolean;
}

function readConfig(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      numClasses: typeof raw.numClasses === 'number' ? raw.numClasses : 4,
      numGroupsPerClass: typeof raw.numGroupsPerClass === 'number' ? raw.numGroupsPerClass : 4,
      classStart: typeof raw.classStart === 'number' ? raw.classStart : 1,
      activeClass: typeof raw.activeClass === 'number' ? raw.activeClass : 1,
      agentMode: normalizeAgentMode(raw.agentMode),
      agentStance: normalizeAgentStance(raw.agentStance),
      realtimeResetting: raw.realtimeResetting === true,
    };
  } catch {
    return {
      numClasses: 4,
      numGroupsPerClass: 4,
      classStart: 1,
      activeClass: 1,
      agentMode: 'pipeline',
      agentStance: DEFAULT_AGENT_STANCE,
      realtimeResetting: false,
    };
  }
}

export async function GET() {
  return NextResponse.json(readConfig());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const current = readConfig();

    const classStart = typeof body.classStart === 'number' ? body.classStart : current.classStart;
    const numClasses = typeof body.numClasses === 'number' ? body.numClasses : current.numClasses;
    const classEnd = classStart + numClasses - 1;

    const updated: AppSettings = {
      numClasses,
      numGroupsPerClass:
        typeof body.numGroupsPerClass === 'number'
          ? body.numGroupsPerClass
          : current.numGroupsPerClass,
      classStart,
      // activeClass가 유효 범위를 벗어나면 classStart로 초기화
      activeClass:
        typeof body.activeClass === 'number'
          ? Math.min(Math.max(body.activeClass, classStart), classEnd)
          : Math.min(Math.max(current.activeClass, classStart), classEnd),
      agentMode: normalizeAgentMode(body.agentMode ?? current.agentMode),
      agentStance: normalizeAgentStance(body.agentStance ?? current.agentStance),
      realtimeResetting:
        typeof body.realtimeResetting === 'boolean'
          ? body.realtimeResetting
          : current.realtimeResetting,
    };

    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: '설정 저장 실패' }, { status: 500 });
  }
}
