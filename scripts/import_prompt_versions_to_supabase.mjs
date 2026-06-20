#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const PROMPT_VERSIONS_DIR = join(REPO_ROOT, "prompt_versions");
const PROMPT_VERSION_INDEX_PATH = join(PROMPT_VERSIONS_DIR, "index.json");
const EVALUATION_MANIFEST_PATH = join(
  REPO_ROOT,
  "prompts",
  "evaluation",
  "manifest.json",
);
const CONDITION_COMBINATION_PROMPT_KEYS = [
  "dominant_no_feedback",
  "dominant_explicit_correction",
  "collaborative_no_feedback",
  "collaborative_explicit_correction",
];
const CONDITION_COMBINATION_PROMPT_ALIASES = {
  dominant_no_feedback: ["dominant_no_corrective"],
  collaborative_no_feedback: ["collaborative_no_corrective"],
};

function parseDotenv(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function loadLocalEnv() {
  for (const filename of [".env.local", ".env"]) {
    try {
      parseDotenv(await readFile(join(REPO_ROOT, filename), "utf-8"));
    } catch {
      // Optional local env file.
    }
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashConfig(config) {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

function normalizeConditionCombinationPrompts(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    CONDITION_COMBINATION_PROMPT_KEYS.map((key) => {
      const candidates = [key, ...(CONDITION_COMBINATION_PROMPT_ALIASES[key] ?? [])];
      const text = candidates
        .map((candidate) => source[candidate])
        .find((candidate) => typeof candidate === "string" && candidate.trim());
      return [key, typeof text === "string" ? text.trim() : ""];
    }),
  );
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractOpening(prompt) {
  const lines = prompt.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() !== "# opening") continue;
    const openingLines = [];
    for (const candidate of lines.slice(index + 1)) {
      const stripped = candidate.trim();
      if (stripped.startsWith("#")) break;
      if (stripped) openingLines.push(stripped.replace(/^"|"$/g, ""));
    }
    return openingLines.join(" ").trim() || null;
  }
  return null;
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return fallback;
  }
}

async function readVersionFiles(purpose) {
  const dir = join(PROMPT_VERSIONS_DIR, purpose);
  try {
    const filenames = await readdir(dir);
    const versions = [];
    for (const filename of filenames.sort()) {
      if (!filename.endsWith(".json")) continue;
      const version = await readJson(join(dir, filename));
      if (version?.purpose === purpose && version?.config && text(version.id)) {
        versions.push(version);
      }
    }
    return versions;
  } catch {
    return [];
  }
}

function getSupabaseEnv() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return { key, url: url.replace(/\/$/, "") };
}

async function callImportRpc(payload) {
  const { key, url } = getSupabaseEnv();
  const response = await fetch(`${url}/rest/v1/rpc/import_prompt_version`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.message || `Supabase import failed with ${response.status}`,
    );
  }
  return data;
}

function evaluationMetadata(evaluationId, prompt, manifest) {
  const entry = manifest?.evaluations?.[evaluationId];
  return {
    character: text(entry?.character) || "Kate",
    openingSentence:
      extractOpening(prompt) ||
      "Hi, I’m Kate. I just moved to Korea. Nice to meet you!",
    version: text(entry?.version),
  };
}

function practicePayload(version, activeId) {
  const config = version.config;
  const conditionCombinationPrompts = normalizeConditionCombinationPrompts(
    config?.conditionCombinationPrompts,
  );
  const required = [
    "basePrompt",
    "dominantPrompt",
    "collaborativePrompt",
    "feedbackConditionId",
    "feedbackPrompt",
    "taskCardId",
    "taskCardPrompt",
  ];
  for (const key of required) {
    if (!text(config?.[key])) {
      throw new Error(
        `Skipping invalid practice version ${version.id}: missing ${key}`,
      );
    }
  }
  return {
    p_base_prompt: config.basePrompt,
    p_collaborative_prompt: config.collaborativePrompt,
    p_condition_combination_prompts: conditionCombinationPrompts,
    p_created_at: version.createdAt,
    p_dominant_prompt: config.dominantPrompt,
    p_feedback_condition_id: config.feedbackConditionId,
    p_feedback_prompt: config.feedbackPrompt,
    p_hash:
      text(version.hash) ||
      hashConfig({
        ...config,
        conditionCombinationPrompts,
      }),
    p_is_active: activeId === version.id,
    p_label: text(version.label) || `practice ${version.createdAt}`,
    p_legacy_file_purpose: "realtime",
    p_legacy_file_version_id: version.id,
    p_purpose: "practice",
    p_task_card_id: config.taskCardId,
    p_task_card_prompt: config.taskCardPrompt,
  };
}

function evaluationPayload(version, activeId, manifest) {
  const config = version.config;
  const evaluationId = text(config?.evaluationId);
  const prompt = text(config?.prompt);
  if (!evaluationId || !prompt) {
    throw new Error(
      `Skipping invalid evaluation version ${version.id}: missing config`,
    );
  }
  const metadata = evaluationMetadata(evaluationId, prompt, manifest);
  return {
    p_created_at: version.createdAt,
    p_evaluation_character: metadata.character,
    p_evaluation_id: evaluationId,
    p_evaluation_opening_sentence: metadata.openingSentence,
    p_evaluation_prompt: prompt,
    p_evaluation_prompt_version: metadata.version,
    p_hash: text(version.hash) || hashConfig(config),
    p_is_active: activeId === version.id,
    p_label: text(version.label) || `evaluation ${version.createdAt}`,
    p_legacy_file_purpose: "evaluation",
    p_legacy_file_version_id: version.id,
    p_purpose: "evaluation",
  };
}

async function main() {
  await loadLocalEnv();
  const index = await readJson(PROMPT_VERSION_INDEX_PATH, {
    active: {},
    versions: {},
  });
  const manifest = await readJson(EVALUATION_MANIFEST_PATH, {});
  const versions = [
    ...(await readVersionFiles("realtime")).map((version) => ({
      payload: practicePayload(version, index.active?.realtime),
      version,
    })),
    ...(await readVersionFiles("evaluation")).map((version) => ({
      payload: evaluationPayload(version, index.active?.evaluation, manifest),
      version,
    })),
  ];

  if (versions.length === 0) {
    console.log("No local prompt version files found.");
    return;
  }

  for (const { payload, version } of versions) {
    const row = await callImportRpc(payload);
    console.log(
      `${version.purpose}:${version.id} -> ${row.id} active=${Boolean(row.is_active)} label=${row.label}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
