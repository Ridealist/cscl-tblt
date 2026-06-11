import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SettingsStoreError, readSettings, writeSettings } from '@/lib/settings-store';
import { getAdminAuthResult } from '@/lib/supabase/admin-auth';

const DEFAULT_PROMPT_SOURCE_DIR = join(process.cwd(), '..', 'prompts', 'realtime');
const PROMPT_SOURCE_MANIFEST_PATH = join(DEFAULT_PROMPT_SOURCE_DIR, 'manifest.json');

interface FeedbackConditionOption {
  id: string;
  title: string;
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

function feedbackConditionIds(feedbackConditions: FeedbackConditionOption[]) {
  return feedbackConditions.map((condition) => condition.id);
}

function settingsErrorResponse(error: unknown, fallbackMessage: string) {
  const status = error instanceof SettingsStoreError ? error.status : 500;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ error: message }, { status });
}

function adminErrorResponse(
  auth: Exclude<Awaited<ReturnType<typeof getAdminAuthResult>>, { ok: true }>
) {
  return NextResponse.json({ error: auth.error }, { status: auth.status });
}

export async function GET() {
  const auth = await getAdminAuthResult();
  if (!auth.ok) return adminErrorResponse(auth);

  const feedbackConditions = readFeedbackConditions();
  try {
    const settings = await readSettings({
      feedbackConditionIds: feedbackConditionIds(feedbackConditions),
    });
    return NextResponse.json({ ...settings, feedbackConditions });
  } catch (error) {
    return settingsErrorResponse(error, '설정 불러오기 실패');
  }
}

export async function POST(req: Request) {
  const auth = await getAdminAuthResult();
  if (!auth.ok) return adminErrorResponse(auth);

  try {
    const body = await req.json();
    const feedbackConditions = readFeedbackConditions();
    const updated = await writeSettings(body, {
      feedbackConditionIds: feedbackConditionIds(feedbackConditions),
      updatedBy: auth.user.id,
    });
    return NextResponse.json({ ...updated, feedbackConditions });
  } catch (error) {
    return settingsErrorResponse(error, '설정 저장 실패');
  }
}
