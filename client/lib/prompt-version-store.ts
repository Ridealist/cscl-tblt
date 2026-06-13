import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export type PromptVersionPurpose = 'realtime' | 'evaluation';

export type PromptVersionSummary = {
  id: string;
  label: string;
  createdAt: string;
  hash: string;
};

export type PromptVersionFile<TConfig = unknown> = PromptVersionSummary & {
  schemaVersion: 1;
  purpose: PromptVersionPurpose;
  config: TConfig;
};

type PromptVersionIndex = {
  active: Partial<Record<PromptVersionPurpose, string | null>>;
  versions: Record<PromptVersionPurpose, PromptVersionSummary[]>;
};

const PROMPT_VERSIONS_DIR = join(process.cwd(), '..', 'prompt_versions');
const PROMPT_VERSION_INDEX_PATH = join(PROMPT_VERSIONS_DIR, 'index.json');
const PROMPT_VERSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function emptyIndex(): PromptVersionIndex {
  return {
    active: {},
    versions: {
      realtime: [],
      evaluation: [],
    },
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashConfig(config: unknown) {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

function normalizeVersionId(versionId: string): string | null {
  const normalized = versionId.trim();
  return PROMPT_VERSION_ID_PATTERN.test(normalized) ? normalized : null;
}

function versionPath(purpose: PromptVersionPurpose, versionId: string) {
  return join(PROMPT_VERSIONS_DIR, purpose, `${versionId}.json`);
}

function normalizeSummary(value: unknown): PromptVersionSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<PromptVersionSummary>;
  if (
    typeof source.id !== 'string' ||
    typeof source.label !== 'string' ||
    typeof source.createdAt !== 'string' ||
    typeof source.hash !== 'string'
  ) {
    return null;
  }
  return {
    id: source.id,
    label: source.label,
    createdAt: source.createdAt,
    hash: source.hash,
  };
}

function normalizeSummaries(value: unknown): PromptVersionSummary[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const summary = normalizeSummary(item);
        return summary ? [summary] : [];
      })
    : [];
}

function normalizeIndex(value: unknown): PromptVersionIndex {
  if (!value || typeof value !== 'object') return emptyIndex();
  const source = value as Partial<PromptVersionIndex>;
  return {
    active:
      source.active && typeof source.active === 'object' && !Array.isArray(source.active)
        ? source.active
        : {},
    versions: {
      realtime: normalizeSummaries(source.versions?.realtime),
      evaluation: normalizeSummaries(source.versions?.evaluation),
    },
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(tempPath, path);
}

export async function readPromptVersionIndex(): Promise<PromptVersionIndex> {
  try {
    return normalizeIndex(JSON.parse(await readFile(PROMPT_VERSION_INDEX_PATH, 'utf-8')));
  } catch {
    return emptyIndex();
  }
}

async function writePromptVersionIndex(index: PromptVersionIndex) {
  await writeJson(PROMPT_VERSION_INDEX_PATH, index);
}

export async function listPromptVersions(
  purpose: PromptVersionPurpose
): Promise<PromptVersionSummary[]> {
  const index = await readPromptVersionIndex();
  return index.versions[purpose];
}

export async function readPromptVersion<TConfig>(
  purpose: PromptVersionPurpose,
  versionId: string
): Promise<PromptVersionFile<TConfig> | null> {
  const normalizedVersionId = normalizeVersionId(versionId);
  if (!normalizedVersionId) return null;

  try {
    const version = JSON.parse(
      await readFile(versionPath(purpose, normalizedVersionId), 'utf-8')
    ) as PromptVersionFile<TConfig> | undefined;
    return version?.purpose === purpose ? version : null;
  } catch {
    return null;
  }
}

export async function readActivePromptVersion<TConfig>(
  purpose: PromptVersionPurpose
): Promise<PromptVersionFile<TConfig> | null> {
  const index = await readPromptVersionIndex();
  const activeVersionId = index.active[purpose];
  return activeVersionId ? readPromptVersion<TConfig>(purpose, activeVersionId) : null;
}

export async function createPromptVersion<TConfig>({
  activate = true,
  config,
  label,
  purpose,
}: {
  activate?: boolean;
  config: TConfig;
  label?: string;
  purpose: PromptVersionPurpose;
}): Promise<PromptVersionFile<TConfig>> {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const version: PromptVersionFile<TConfig> = {
    schemaVersion: 1,
    purpose,
    id,
    label: label?.trim() || `${purpose} ${createdAt}`,
    createdAt,
    hash: hashConfig(config),
    config,
  };

  await writeJson(versionPath(purpose, id), version);

  const index = await readPromptVersionIndex();
  const summary: PromptVersionSummary = {
    id: version.id,
    label: version.label,
    createdAt: version.createdAt,
    hash: version.hash,
  };
  index.versions[purpose] = [summary, ...index.versions[purpose]];
  if (activate) {
    index.active[purpose] = id;
  }
  await writePromptVersionIndex(index);

  return version;
}

export async function activatePromptVersion<TConfig = unknown>(
  purpose: PromptVersionPurpose,
  versionId: string
): Promise<PromptVersionFile<TConfig> | null> {
  const version = await readPromptVersion<TConfig>(purpose, versionId);
  if (!version) return null;

  const index = await readPromptVersionIndex();
  index.active[purpose] = versionId;
  await writePromptVersionIndex(index);
  return version;
}

export async function clearActivePromptVersion(purpose: PromptVersionPurpose): Promise<void> {
  const index = await readPromptVersionIndex();
  index.active[purpose] = null;
  await writePromptVersionIndex(index);
}

export async function deletePromptVersion(
  purpose: PromptVersionPurpose,
  versionId: string
): Promise<void> {
  const normalizedVersionId = normalizeVersionId(versionId);
  if (!normalizedVersionId) return;

  const index = await readPromptVersionIndex();
  index.versions[purpose] = index.versions[purpose].filter(
    (version) => version.id !== normalizedVersionId
  );
  if (index.active[purpose] === normalizedVersionId) {
    index.active[purpose] = null;
  }

  try {
    await unlink(versionPath(purpose, normalizedVersionId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await writePromptVersionIndex(index);
}
