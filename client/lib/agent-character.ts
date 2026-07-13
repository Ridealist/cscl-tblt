export type AgentCharacter = {
  id: string;
  displayName: string;
  avatarSrc: string;
};

export type RealtimeTaskCharacter = AgentCharacter & {
  voiceId: string;
  ttsSpeed: number;
  ttsVolume: number;
};

export const KATE_CHARACTER: AgentCharacter = {
  id: 'kate',
  displayName: 'Kate',
  avatarSrc: '/agents/kate_photo_20260615.png',
};

export const JACK_CHARACTER: AgentCharacter = {
  id: 'jack',
  displayName: 'Jack',
  avatarSrc: '/agents/jack_photo.png',
};

export const KATE_TASK_CHARACTER: RealtimeTaskCharacter = {
  ...KATE_CHARACTER,
  voiceId: 'b7d50908-b17c-442d-ad8d-810c63997ed9',
  ttsSpeed: 0.8,
  ttsVolume: 1.1,
};

export const JACK_TASK_CHARACTER: RealtimeTaskCharacter = {
  ...JACK_CHARACTER,
  voiceId: '630ed21c-2c5c-41cf-9d82-10a7fd668370',
  ttsSpeed: 0.8,
  ttsVolume: 1.0,
};

export function normalizeAgentCharacter(value: unknown): AgentCharacter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return KATE_CHARACTER;
  const source = value as Record<string, unknown>;
  if (
    typeof source.id !== 'string' ||
    typeof source.displayName !== 'string' ||
    typeof source.avatarSrc !== 'string'
  ) {
    return KATE_CHARACTER;
  }
  return {
    id: source.id,
    displayName: source.displayName,
    avatarSrc: source.avatarSrc,
  };
}

export function normalizeRealtimeTaskCharacter(value: unknown): RealtimeTaskCharacter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.id !== 'string' ||
    typeof source.displayName !== 'string' ||
    typeof source.avatarSrc !== 'string' ||
    typeof source.voiceId !== 'string' ||
    typeof source.ttsSpeed !== 'number' ||
    typeof source.ttsVolume !== 'number'
  ) {
    return null;
  }
  return {
    id: source.id,
    displayName: source.displayName,
    avatarSrc: source.avatarSrc,
    voiceId: source.voiceId,
    ttsSpeed: source.ttsSpeed,
    ttsVolume: source.ttsVolume,
  };
}

export function inferRealtimeTaskCharacterName(prompt: string): string | null {
  const characterSection = prompt.match(
    /^#+\s+Character Information\s*$([\s\S]*?)(?=^#|(?![\s\S]))/im
  )?.[1];
  const name = characterSection?.match(/^\s*[*-]\s*Name:\s*([^\r\n]+?)\s*$/im)?.[1];
  const openingName = prompt.match(
    /^#\s+Opening\s*$[\s\S]*?\bI(?:'|’|\s+a)m\s+([A-Za-z][\w-]*)\b/im
  )?.[1];
  return (name ?? openingName)?.trim() || null;
}

export function inferRealtimeTaskCharacter(prompt: string): RealtimeTaskCharacter | null {
  const resolved = inferRealtimeTaskCharacterName(prompt)?.toLowerCase();
  if (resolved === 'jack') return JACK_TASK_CHARACTER;
  if (resolved === 'kate') return KATE_TASK_CHARACTER;
  return null;
}

export function resolveManifestTaskCharacter(
  characters: unknown,
  mappedCharacterId: unknown,
  inferredName?: string | null
): RealtimeTaskCharacter | null {
  if (!characters || typeof characters !== 'object' || Array.isArray(characters)) return null;
  const entries = Object.entries(characters as Record<string, unknown>);
  const inferredEntry = inferredName
    ? entries.find(([, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const displayName = (value as Record<string, unknown>).displayName;
        return (
          typeof displayName === 'string' &&
          displayName.localeCompare(inferredName, undefined, { sensitivity: 'accent' }) === 0
        );
      })
    : undefined;
  const characterId =
    inferredEntry?.[0] ?? (typeof mappedCharacterId === 'string' ? mappedCharacterId : null);
  if (!characterId) return null;
  const value = inferredEntry?.[1] ?? (characters as Record<string, unknown>)[characterId];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return normalizeRealtimeTaskCharacter({ id: characterId, ...value });
}
