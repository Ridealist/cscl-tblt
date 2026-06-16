import 'server-only';
import {
  type PracticePromptVersion,
  PromptVersionStoreError,
  activatePracticePromptVersion,
  clearActivePromptVersion,
  deletePromptVersion,
  listPromptVersions,
  readActivePracticePromptVersion,
  readPracticePromptVersion,
  savePracticePromptVersion,
} from '@/lib/prompt-version-db-store';
import type { RealtimePromptConfig } from '@/lib/realtime-prompt-config';

export type RealtimePromptVersion = PracticePromptVersion;
export { PromptVersionStoreError as RealtimePromptStoreError };

export async function listRealtimePromptVersions() {
  return listPromptVersions('practice');
}

export async function readRealtimePromptVersion(
  versionId: string
): Promise<RealtimePromptVersion | null> {
  return readPracticePromptVersion(versionId);
}

export async function readActiveRealtimePromptVersion(): Promise<RealtimePromptVersion | null> {
  return readActivePracticePromptVersion();
}

export async function saveRealtimePromptVersion(
  config: RealtimePromptConfig,
  options: { createdBy?: string | null; label?: string | null } = {}
): Promise<RealtimePromptVersion> {
  return savePracticePromptVersion(config, options);
}

export async function activateRealtimePromptVersion(
  versionId: string
): Promise<RealtimePromptVersion> {
  return activatePracticePromptVersion(versionId);
}

export async function deleteRealtimePromptVersion(versionId: string): Promise<void> {
  await deletePromptVersion(versionId, 'practice');
}

export async function deactivateActiveRealtimePromptVersion(): Promise<void> {
  await clearActivePromptVersion('practice');
}
