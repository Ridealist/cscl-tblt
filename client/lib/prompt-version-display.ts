const GENERATED_PROMPT_VERSION_LABEL_PATTERN =
  /^(practice|realtime|evaluation)\s+\d{4}-\d{2}-\d{2}(?:[T\s]|$)/;
const GENERATED_PROMPT_VERSION_LABEL_PREFIXES = ['practice', 'realtime', 'evaluation'];
const NO_CUSTOM_PROMPT_VERSION_LABEL = '사용자 지정 버전명 없음';

export function isGeneratedPromptVersionLabel(label?: string | null, versionId?: string) {
  const trimmed = label?.trim();
  if (!trimmed) return false;
  if (GENERATED_PROMPT_VERSION_LABEL_PATTERN.test(trimmed)) return true;
  return GENERATED_PROMPT_VERSION_LABEL_PREFIXES.some(
    (prefix) => trimmed === `${prefix} ${versionId}`
  );
}

export function promptVersionCustomLabel({ id, label }: { id: string; label?: string | null }) {
  const trimmed = label?.trim();
  if (!trimmed || isGeneratedPromptVersionLabel(trimmed, id)) return null;
  return trimmed;
}

export function promptVersionDisplayLabel({
  id,
  label,
  usingDefault = false,
}: {
  id: string;
  label?: string | null;
  usingDefault?: boolean;
}) {
  if (usingDefault) return 'Tracked markdown default';
  return promptVersionCustomLabel({ id, label }) ?? id;
}

export function promptVersionCustomLabelDisplay({
  id,
  label,
  usingDefault = false,
}: {
  id: string;
  label?: string | null;
  usingDefault?: boolean;
}) {
  if (usingDefault) return '기본값';
  return promptVersionCustomLabel({ id, label }) ?? NO_CUSTOM_PROMPT_VERSION_LABEL;
}
