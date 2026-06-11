import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { type AgentMode, normalizeAgentMode } from '@/lib/agent-mode';
import { type AgentRole, DEFAULT_AGENT_ROLE, normalizeAgentRole } from '@/lib/agent-role';
import { requireAdmin } from '@/lib/supabase/admin-auth';

const CONFIG_PATH = join(process.cwd(), '..', 'config.json');
const DEFAULT_PROMPT_SOURCE_DIR = join(process.cwd(), '..', 'prompts', 'realtime');
const PROMPT_SOURCE_MANIFEST_PATH = join(DEFAULT_PROMPT_SOURCE_DIR, 'manifest.json');
const DEFAULT_FEEDBACK_CONDITION_ID = 'no_corrective';

interface FeedbackConditionOption {
  id: string;
  title: string;
}

interface AppSettings {
  numClasses: number;
  numGroupsPerClass: number;
  classStart: number;
  activeClass: number;
  agentMode: AgentMode;
  agentRole: AgentRole;
  feedbackConditionId: string;
  realtimeResetting: boolean;
}

function fallbackFeedbackConditions(): FeedbackConditionOption[] {
  return [
    { id: 'no_corrective', title: 'No Corrective Feedback' },
    { id: 'explicit_correction', title: 'Explicit Correction' },
  ];
}

function readFeedbackConditions(): FeedbackConditionOption[] {
  try {
    const manifest = JSON.parse(readFileSync(PROMPT_SOURCE_MANIFEST_PATH, 'utf-8')) as {
      feedbackConditionManifest?: unknown;
    };
    const manifestFile =
      typeof manifest.feedbackConditionManifest === 'string' && manifest.feedbackConditionManifest
        ? manifest.feedbackConditionManifest
        : 'feedbacks/manifest.json';
    const feedbackManifest = JSON.parse(
      readFileSync(join(DEFAULT_PROMPT_SOURCE_DIR, manifestFile), 'utf-8')
    ) as Record<string, { title?: unknown }>;
    const options = Object.entries(feedbackManifest).map(([id, entry]) => ({
      id,
      title: typeof entry.title === 'string' && entry.title ? entry.title : id,
    }));
    return options.length > 0 ? options : fallbackFeedbackConditions();
  } catch {
    return fallbackFeedbackConditions();
  }
}

function normalizeFeedbackConditionId(
  value: unknown,
  feedbackConditions: FeedbackConditionOption[]
): string {
  const fallback =
    feedbackConditions.find((condition) => condition.id === DEFAULT_FEEDBACK_CONDITION_ID)?.id ??
    feedbackConditions[0]?.id ??
    DEFAULT_FEEDBACK_CONDITION_ID;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const candidate = value.trim();
  return feedbackConditions.some((condition) => condition.id === candidate) ? candidate : fallback;
}

function readConfig(feedbackConditions = readFeedbackConditions()): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      numClasses: typeof raw.numClasses === 'number' ? raw.numClasses : 4,
      numGroupsPerClass: typeof raw.numGroupsPerClass === 'number' ? raw.numGroupsPerClass : 4,
      classStart: typeof raw.classStart === 'number' ? raw.classStart : 1,
      activeClass: typeof raw.activeClass === 'number' ? raw.activeClass : 1,
      agentMode: normalizeAgentMode(raw.agentMode),
      agentRole: normalizeAgentRole(raw.agentRole ?? raw.agentStance),
      feedbackConditionId: normalizeFeedbackConditionId(
        raw.feedbackConditionId,
        feedbackConditions
      ),
      realtimeResetting: raw.realtimeResetting === true,
    };
  } catch {
    return {
      numClasses: 4,
      numGroupsPerClass: 4,
      classStart: 1,
      activeClass: 1,
      agentMode: 'pipeline',
      agentRole: DEFAULT_AGENT_ROLE,
      feedbackConditionId: normalizeFeedbackConditionId(null, feedbackConditions),
      realtimeResetting: false,
    };
  }
}

export async function GET() {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const feedbackConditions = readFeedbackConditions();
  return NextResponse.json({ ...readConfig(feedbackConditions), feedbackConditions });
}

export async function POST(req: Request) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const body = await req.json();
    const feedbackConditions = readFeedbackConditions();
    const current = readConfig(feedbackConditions);

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
      agentRole: normalizeAgentRole(body.agentRole ?? body.agentStance ?? current.agentRole),
      feedbackConditionId: normalizeFeedbackConditionId(
        body.feedbackConditionId ?? current.feedbackConditionId,
        feedbackConditions
      ),
      realtimeResetting:
        typeof body.realtimeResetting === 'boolean'
          ? body.realtimeResetting
          : current.realtimeResetting,
    };

    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
    return NextResponse.json({ ...updated, feedbackConditions });
  } catch {
    return NextResponse.json({ error: '설정 저장 실패' }, { status: 500 });
  }
}
