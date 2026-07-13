import { readFile } from 'fs/promises';
import { join } from 'path';
import 'server-only';
import {
  KATE_TASK_CHARACTER,
  type RealtimeTaskCharacter,
  inferRealtimeTaskCharacterName,
  resolveManifestTaskCharacter,
} from '@/lib/agent-character';

const PROMPT_DIR = join(process.cwd(), '..', 'prompts', 'realtime');

export async function readRealtimeTaskCharacter(
  taskCardId?: string,
  taskCardPrompt?: string
): Promise<RealtimeTaskCharacter> {
  const inferredName = taskCardPrompt ? inferRealtimeTaskCharacterName(taskCardPrompt) : null;
  try {
    const manifest = JSON.parse(await readFile(join(PROMPT_DIR, 'manifest.json'), 'utf-8')) as {
      characterManifest?: unknown;
      defaultTaskCardId?: unknown;
      taskCardManifest?: unknown;
    };
    const taskManifestPath =
      typeof manifest.taskCardManifest === 'string'
        ? manifest.taskCardManifest
        : 'task-cards/manifest.json';
    const characterManifestPath =
      typeof manifest.characterManifest === 'string'
        ? manifest.characterManifest
        : 'characters/manifest.json';
    const selectedTaskId =
      taskCardId ||
      (typeof manifest.defaultTaskCardId === 'string' ? manifest.defaultTaskCardId : '');
    const taskCards = JSON.parse(
      await readFile(join(PROMPT_DIR, taskManifestPath), 'utf-8')
    ) as Record<string, { characterId?: unknown }>;
    const characters = JSON.parse(
      await readFile(join(PROMPT_DIR, characterManifestPath), 'utf-8')
    ) as Record<string, Record<string, unknown>>;
    const mappedCharacterId = taskCards[selectedTaskId]?.characterId;
    const resolved = resolveManifestTaskCharacter(characters, mappedCharacterId, inferredName);
    if (!resolved) {
      throw new Error('Task character metadata is incomplete.');
    }
    return resolved;
  } catch {
    return {
      ...KATE_TASK_CHARACTER,
    };
  }
}
