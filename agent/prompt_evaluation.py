import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEFAULT_EVALUATION_ID = "pretest_6_10"
DEFAULT_OPENING_SENTENCE = "Hi, I’m Kate. I just moved to Korea. Nice to meet you!"
DEFAULT_PROMPT_SOURCE_DIR = Path(__file__).parent.parent / "prompts" / "evaluation"
PROMPT_SOURCE_MANIFEST_PATH = DEFAULT_PROMPT_SOURCE_DIR / "manifest.json"
PROMPT_VERSION_COLUMNS = ",".join(
    (
        "id",
        "purpose",
        "evaluation_id",
        "evaluation_prompt",
        "evaluation_prompt_version",
        "evaluation_character",
        "evaluation_opening_sentence",
        "source",
        "created_at",
    )
)


@dataclass(frozen=True)
class ResolvedEvaluationPrompt:
    evaluation_id: str
    prompt: str
    evaluation_prompt_id: str
    evaluation_prompt_version: str | None
    evaluation_character: str
    opening_sentence: str
    source: str = "evaluation"
    prompt_version_id: str | None = None
    saved_at: str | None = None
    task_card_id: str | None = None
    feedback_condition: str | None = None


def _valid_text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


class PromptVersionFetchError(RuntimeError):
    pass


def _get_supabase_prompt_env() -> tuple[str, str]:
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    ).strip()
    key = (
        os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    ).strip()
    if not url or not key:
        raise PromptVersionFetchError(
            "Supabase prompt version fetch is not configured."
        )
    return url.rstrip("/"), key


def _fetch_prompt_version_row(prompt_version_id: str) -> dict:
    version_id = prompt_version_id.strip()
    if not version_id:
        raise PromptVersionFetchError("Prompt version id is empty.")
    url, key = _get_supabase_prompt_env()
    endpoint = (
        f"{url}/rest/v1/prompt_versions"
        f"?id=eq.{quote(version_id, safe='')}"
        f"&purpose=eq.evaluation&select={PROMPT_VERSION_COLUMNS}"
    )
    request = Request(
        endpoint,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {key}",
            "apikey": key,
        },
    )
    try:
        with urlopen(request, timeout=5) as response:
            payload = response.read().decode("utf-8")
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise PromptVersionFetchError(
            f"Prompt version fetch failed: {version_id}"
        ) from exc

    try:
        rows = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise PromptVersionFetchError(
            f"Prompt version response is invalid JSON: {version_id}"
        ) from exc
    if not isinstance(rows, list) or not rows:
        raise PromptVersionFetchError(f"Prompt version was not found: {version_id}")
    row = rows[0]
    if not isinstance(row, dict):
        raise PromptVersionFetchError(
            f"Prompt version response has invalid shape: {version_id}"
        )
    if row.get("purpose") != "evaluation":
        raise PromptVersionFetchError(f"Prompt version is not an evaluation version: {version_id}")
    return row


def _extract_opening(prompt: str) -> str | None:
    lines = prompt.splitlines()
    for index, line in enumerate(lines):
        if line.strip().lower() != "# opening":
            continue

        opening_lines = []
        for candidate in lines[index + 1 :]:
            stripped = candidate.strip()
            if stripped.startswith("#"):
                break
            if stripped:
                opening_lines.append(stripped.strip('"'))
        opening = " ".join(opening_lines).strip()
        return opening or None
    return None


def _load_prompt_version_source(prompt_version_id: str) -> ResolvedEvaluationPrompt:
    row = _fetch_prompt_version_row(prompt_version_id)
    version_id = _valid_text(row.get("id")) or prompt_version_id.strip()
    evaluation_id = _valid_text(row.get("evaluation_id"))
    prompt = _valid_text(row.get("evaluation_prompt"))
    evaluation_character = _valid_text(row.get("evaluation_character")) or "Kate"
    opening_sentence = _valid_text(row.get("evaluation_opening_sentence"))
    if not evaluation_id or not prompt or not opening_sentence:
        raise PromptVersionFetchError(
            f"Prompt version row is missing required evaluation fields: {version_id}"
        )

    saved_at = _valid_text(row.get("created_at"))
    return ResolvedEvaluationPrompt(
        evaluation_id=evaluation_id,
        prompt=prompt,
        evaluation_prompt_id=version_id,
        evaluation_prompt_version=_valid_text(row.get("evaluation_prompt_version")),
        evaluation_character=evaluation_character,
        opening_sentence=_extract_opening(prompt) or opening_sentence,
        source="custom",
        prompt_version_id=version_id,
        saved_at=saved_at,
    )


def _read_manifest() -> dict:
    try:
        manifest = json.loads(PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            f"Evaluation prompt manifest is missing or invalid: {PROMPT_SOURCE_MANIFEST_PATH}"
        ) from exc
    if not isinstance(manifest, dict):
        raise RuntimeError("Evaluation prompt manifest has invalid shape.")
    return manifest


def load_prompt_source(
    evaluation_id: str | None = None,
    prompt_version_id: str | None = None,
) -> ResolvedEvaluationPrompt:
    if isinstance(prompt_version_id, str) and prompt_version_id.strip():
        return _load_prompt_version_source(prompt_version_id)

    manifest = _read_manifest()
    default_id = _valid_text(manifest.get("defaultEvaluationId")) or DEFAULT_EVALUATION_ID
    selected_id = _valid_text(evaluation_id) or default_id
    evaluations = manifest.get("evaluations")
    if not isinstance(evaluations, dict):
        raise RuntimeError("Evaluation prompt manifest is missing evaluations.")

    entry = evaluations.get(selected_id)
    if not isinstance(entry, dict):
        raise RuntimeError(f"Evaluation prompt was not found: {selected_id}")

    filename = _valid_text(entry.get("file"))
    marker = _valid_text(entry.get("marker"))
    if not filename or not marker:
        raise RuntimeError(f"Evaluation prompt entry is invalid: {selected_id}")

    try:
        prompt = (DEFAULT_PROMPT_SOURCE_DIR / filename).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Evaluation prompt file is missing: {filename}") from exc
    if not prompt or not prompt.startswith(marker):
        raise RuntimeError(f"Evaluation prompt marker mismatch: {selected_id}")

    prompt_id = _valid_text(entry.get("promptId")) or selected_id
    prompt_version = _valid_text(entry.get("version"))

    return ResolvedEvaluationPrompt(
        evaluation_id=selected_id,
        prompt=prompt,
        evaluation_prompt_id=prompt_id,
        evaluation_prompt_version=prompt_version,
        evaluation_character=_valid_text(entry.get("character")) or "Kate",
        opening_sentence=_extract_opening(prompt) or DEFAULT_OPENING_SENTENCE,
    )


def get_opening_sentence_from_source(source: ResolvedEvaluationPrompt) -> str:
    return source.opening_sentence


def build_prompt_from_source(
    source: ResolvedEvaluationPrompt,
    participant_name: str | None = None,
    role: str | None = None,
) -> str:
    del role
    prompt = source.prompt
    name = participant_name.strip() if participant_name else ""

    if name:
        prompt += (
            "\n\n# SESSION INFO\n"
            "This is a one-on-one call with one Korean 6th-grade EFL student.\n"
            f"Your friend's name is {name}.\n"
            f"You may use {name}'s name naturally.\n"
            "Do not treat the displayed name as a replacement for talking together.\n"
        )

    return prompt


def build_prompt(
    participant_name: str | None = None,
    evaluation_id: str | None = None,
    prompt_version_id: str | None = None,
) -> str:
    source = load_prompt_source(evaluation_id, prompt_version_id)
    return build_prompt_from_source(source, participant_name)
