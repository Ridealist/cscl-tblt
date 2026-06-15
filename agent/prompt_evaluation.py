import json
import re
from dataclasses import dataclass
from pathlib import Path


DEFAULT_EVALUATION_ID = "pretest_6_10"
DEFAULT_OPENING_SENTENCE = "Hi, I’m Kate. I’m new here. Nice to meet you!"
DEFAULT_PROMPT_SOURCE_DIR = Path(__file__).parent.parent / "prompts" / "evaluation"
PROMPT_SOURCE_MANIFEST_PATH = DEFAULT_PROMPT_SOURCE_DIR / "manifest.json"
PROMPT_CONFIG_PATH = Path(__file__).parent.parent / "prompt_config.json"
PROMPT_VERSIONS_DIR = Path(__file__).parent.parent / "prompt_versions"
PROMPT_VERSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


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


def _valid_version_id(value: object) -> str | None:
    version_id = _valid_text(value)
    if version_id and PROMPT_VERSION_ID_PATTERN.match(version_id):
        return version_id
    return None


def _load_prompt_override(
    evaluation_id: str,
) -> tuple[str, str, str | None] | None:
    try:
        raw = json.loads(PROMPT_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    evaluation = raw.get("evaluation")
    if not isinstance(evaluation, dict):
        return None
    prompts = evaluation.get("evaluationPrompts")
    if not isinstance(prompts, dict):
        return None
    entry = prompts.get(evaluation_id)
    if not isinstance(entry, dict):
        return None
    prompt = _valid_text(entry.get("prompt"))
    if not prompt:
        return None
    prompt_id = _valid_text(entry.get("promptId")) or f"custom-{evaluation_id}"
    saved_at = _valid_text(entry.get("savedAt"))
    return prompt, prompt_id, saved_at


def _load_prompt_version_override(
    version_id: str | None,
) -> tuple[str, str, str, str | None] | None:
    safe_version_id = _valid_version_id(version_id)
    if not safe_version_id:
        return None
    try:
        raw = json.loads(
            (PROMPT_VERSIONS_DIR / "evaluation" / f"{safe_version_id}.json").read_text(
                encoding="utf-8"
            )
        )
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict) or raw.get("purpose") != "evaluation":
        return None
    config = raw.get("config")
    if not isinstance(config, dict):
        return None
    evaluation_id = _valid_text(config.get("evaluationId"))
    prompt = _valid_text(config.get("prompt"))
    if not evaluation_id or not prompt:
        return None
    saved_at = _valid_text(raw.get("createdAt"))
    prompt_id = _valid_text(raw.get("id")) or safe_version_id
    return evaluation_id, prompt, prompt_id, saved_at


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
    manifest = _read_manifest()
    default_id = _valid_text(manifest.get("defaultEvaluationId")) or DEFAULT_EVALUATION_ID
    version_override = _load_prompt_version_override(prompt_version_id)
    selected_id = (
        version_override[0]
        if version_override
        else _valid_text(evaluation_id) or default_id
    )
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
    saved_at = None
    source = "evaluation"
    resolved_prompt_version_id = None
    if version_override:
        _, prompt, prompt_id, saved_at = version_override
        source = "custom"
        resolved_prompt_version_id = prompt_id
    else:
        override = _load_prompt_override(selected_id)
        if override:
            prompt, prompt_id, saved_at = override
            source = "custom"
            resolved_prompt_version_id = prompt_id

    return ResolvedEvaluationPrompt(
        evaluation_id=selected_id,
        prompt=prompt,
        evaluation_prompt_id=prompt_id,
        evaluation_prompt_version=prompt_version,
        evaluation_character=_valid_text(entry.get("character")) or "Kate",
        opening_sentence=_extract_opening(prompt) or DEFAULT_OPENING_SENTENCE,
        source=source,
        prompt_version_id=resolved_prompt_version_id,
        saved_at=saved_at,
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
