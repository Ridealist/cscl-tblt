import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


AgentRole = Literal["dominant", "collaborative"]
FeedbackCondition = Literal["no_corrective", "explicit_correction"]
PromptSource = Literal["default", "custom"]
DEFAULT_FEEDBACK_CONDITION_ID: FeedbackCondition = "no_corrective"
DEFAULT_OPENING_SENTENCE = (
    "Hi, I'm Kate. Let's talk about today's task together. What is your name?"
)
DEFAULT_PROMPT_SOURCE_DIR = Path(__file__).parent.parent / "prompts" / "realtime"
PROMPT_SOURCE_MANIFEST_PATH = DEFAULT_PROMPT_SOURCE_DIR / "manifest.json"
PROMPT_FIELDS = ("basePrompt", "dominantPrompt", "collaborativePrompt")
CONDITION_COMBINATION_PROMPT_KEYS = (
    "dominant_no_corrective",
    "dominant_explicit_correction",
    "collaborative_no_corrective",
    "collaborative_explicit_correction",
)
PROMPT_VERSION_COLUMNS = ",".join(
    (
        "id",
        "purpose",
        "base_prompt",
        "dominant_prompt",
        "collaborative_prompt",
        "feedback_condition_id",
        "feedback_prompt",
        "condition_combination_prompts",
        "task_card_id",
        "task_card_prompt",
        "source",
        "is_active",
        "created_at",
    )
)


class PromptVersionFetchError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResolvedRealtimePrompt:
    base_prompt: str
    role_prompts: dict[AgentRole, str]
    feedback_condition: FeedbackCondition
    feedback_prompt: str
    task_card_prompt: str
    source: PromptSource
    condition_combination_prompts: dict[str, str] = field(default_factory=dict)
    prompt_version_id: str | None = None
    saved_at: str | None = None
    task_card_id: str | None = None

    def as_tuple(
        self,
    ) -> tuple[
        str,
        dict[AgentRole, str],
        FeedbackCondition,
        str,
        str,
    ]:
        return (
            self.base_prompt,
            self.role_prompts,
            self.feedback_condition,
            self.feedback_prompt,
            self.task_card_prompt,
        )


def normalize_role(role: str | None = None) -> AgentRole:
    if role in ("collaborative", "passive"):
        return "collaborative"
    return "dominant"


def normalize_feedback_condition(value: str | None = None) -> FeedbackCondition:
    if value in ("explicit_correction", "explicit", "correction"):
        return "explicit_correction"
    return DEFAULT_FEEDBACK_CONDITION_ID


def normalize_condition_combination_prompts(value: object) -> dict[str, str]:
    source = value if isinstance(value, dict) else {}
    return {
        key: source[key].strip() if isinstance(source.get(key), str) else ""
        for key in CONDITION_COMBINATION_PROMPT_KEYS
    }


def _condition_combination_key(
    role: str | None,
    feedback: str | None,
) -> str:
    return f"{normalize_role(role)}_{normalize_feedback_condition(feedback)}"


def _valid_prompt_text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _extract_task_card_opening(task_card_prompt: str) -> str | None:
    lines = task_card_prompt.splitlines()
    for index, line in enumerate(lines):
        if line.strip().lower() != "# opening":
            continue

        opening_lines = []
        for candidate in lines[index + 1 :]:
            stripped = candidate.strip()
            if stripped.startswith("#"):
                break
            if stripped:
                opening_lines.append(stripped)
        opening = " ".join(opening_lines).strip()
        return opening or None
    return None


def _load_feedback_source(
    source_dir: Path,
    manifest: dict,
    feedback_condition_id: str | None = None,
) -> tuple[FeedbackCondition, str] | None:
    manifest_file = manifest.get("feedbackConditionManifest", "feedbacks/manifest.json")
    default_feedback_condition_id = manifest.get(
        "defaultFeedbackConditionId", DEFAULT_FEEDBACK_CONDITION_ID
    )
    selected_id = normalize_feedback_condition(
        feedback_condition_id
        if isinstance(feedback_condition_id, str) and feedback_condition_id.strip()
        else default_feedback_condition_id if isinstance(default_feedback_condition_id, str) else None
    )
    if not isinstance(manifest_file, str) or not manifest_file:
        return None

    try:
        feedbacks = json.loads((source_dir / manifest_file).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(feedbacks, dict):
        return None

    entry = feedbacks.get(selected_id)
    if not isinstance(entry, dict):
        return None
    filename = entry.get("file")
    marker = entry.get("marker")
    if not isinstance(filename, str) or not isinstance(marker, str):
        return None
    try:
        value = (source_dir / "feedbacks" / filename).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not value or not value.startswith(marker):
        return None
    return selected_id, value


def _load_default_feedback_prompt(
    feedback_condition_id: str | None = None,
) -> tuple[FeedbackCondition, str] | None:
    try:
        manifest = json.loads(PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(manifest, dict):
        return None
    return _load_feedback_source(DEFAULT_PROMPT_SOURCE_DIR, manifest, feedback_condition_id)


def _load_task_card_source(
    source_dir: Path,
    manifest: dict,
    task_card_id: str | None = None,
) -> str | None:
    legacy_entry = manifest.get("taskCardPrompt")
    if isinstance(legacy_entry, dict) and task_card_id is None:
        filename = legacy_entry.get("file")
        marker = legacy_entry.get("marker")
        if not isinstance(filename, str) or not isinstance(marker, str):
            return None
        try:
            value = (source_dir / filename).read_text(encoding="utf-8").strip()
        except OSError:
            return None
        return value if value and value.startswith(marker) else None

    manifest_file = manifest.get("taskCardManifest", "task-cards/manifest.json")
    default_task_card_id = manifest.get("defaultTaskCardId")
    selected_id = task_card_id or default_task_card_id
    if not isinstance(manifest_file, str) or not isinstance(selected_id, str) or not selected_id:
        return None

    try:
        task_cards = json.loads((source_dir / manifest_file).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(task_cards, dict):
        return None

    entry = task_cards.get(selected_id)
    if not isinstance(entry, dict):
        return None
    filename = entry.get("file")
    marker = entry.get("marker")
    if not isinstance(filename, str) or not isinstance(marker, str):
        return None
    try:
        value = (source_dir / "task-cards" / filename).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not value or not value.startswith(marker):
        return None
    return value


def _read_default_task_card_id() -> str | None:
    try:
        manifest = json.loads(PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(manifest, dict):
        return None
    task_card_id = manifest.get("defaultTaskCardId")
    return task_card_id.strip() if isinstance(task_card_id, str) and task_card_id.strip() else None


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
        f"&purpose=eq.practice&select={PROMPT_VERSION_COLUMNS}"
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
    if row.get("purpose") != "practice":
        raise PromptVersionFetchError(f"Prompt version is not a practice version: {version_id}")
    return row


def _load_prompt_version_source(
    prompt_version_id: str,
    feedback_condition_id: str | None = None,
) -> ResolvedRealtimePrompt:
    row = _fetch_prompt_version_row(prompt_version_id)
    base_prompt = _valid_prompt_text(row.get("base_prompt"))
    dominant_prompt = _valid_prompt_text(row.get("dominant_prompt"))
    collaborative_prompt = _valid_prompt_text(row.get("collaborative_prompt"))
    feedback_prompt = _valid_prompt_text(row.get("feedback_prompt"))
    task_card_prompt = _valid_prompt_text(row.get("task_card_prompt"))
    row_version_id = row.get("id")
    resolved_version_id = (
        row_version_id.strip()
        if isinstance(row_version_id, str) and row_version_id.strip()
        else prompt_version_id.strip()
    )
    task_card_id = row.get("task_card_id")
    resolved_task_card_id = (
        task_card_id.strip()
        if isinstance(task_card_id, str) and task_card_id.strip()
        else None
    )
    row_feedback_condition_id = row.get("feedback_condition_id")
    row_feedback = normalize_feedback_condition(
        row_feedback_condition_id
        if isinstance(row_feedback_condition_id, str) and row_feedback_condition_id.strip()
        else None
    )
    runtime_feedback = (
        normalize_feedback_condition(feedback_condition_id)
        if isinstance(feedback_condition_id, str) and feedback_condition_id.strip()
        else None
    )
    selected_feedback = runtime_feedback or row_feedback
    if runtime_feedback and runtime_feedback != row_feedback:
        default_feedback = _load_default_feedback_prompt(runtime_feedback)
        if default_feedback:
            selected_feedback, feedback_prompt = default_feedback
    saved_at = row.get("created_at")

    if not all(
        (
            base_prompt,
            dominant_prompt,
            collaborative_prompt,
            feedback_prompt,
            task_card_prompt,
        )
    ):
        raise PromptVersionFetchError(
            f"Prompt version row is missing required prompt fields: {resolved_version_id}"
        )

    return ResolvedRealtimePrompt(
        base_prompt=base_prompt,
        role_prompts={
            "dominant": dominant_prompt,
            "collaborative": collaborative_prompt,
        },
        feedback_condition=selected_feedback,
        feedback_prompt=feedback_prompt,
        condition_combination_prompts=normalize_condition_combination_prompts(
            row.get("condition_combination_prompts")
        ),
        task_card_prompt=task_card_prompt,
        source="custom",
        prompt_version_id=resolved_version_id,
        saved_at=saved_at if isinstance(saved_at, str) and saved_at.strip() else None,
        task_card_id=resolved_task_card_id,
    )


def _load_prompt_source_dir(
    path: Path,
    task_card_id: str | None = None,
    feedback_condition_id: str | None = None,
) -> tuple[
    str,
    dict[AgentRole, str],
    FeedbackCondition,
    str,
    str,
] | None:
    try:
        manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(manifest, dict):
        return None

    values = {}
    for key in PROMPT_FIELDS:
        entry = manifest.get(key)
        if not isinstance(entry, dict):
            return None
        filename = entry.get("file")
        marker = entry.get("marker")
        if not isinstance(filename, str) or not isinstance(marker, str):
            return None
        try:
            values[key] = (path / filename).read_text(encoding="utf-8").strip()
        except OSError:
            return None
        if not values[key] or not values[key].startswith(marker):
            return None

    feedback_source = _load_feedback_source(path, manifest, feedback_condition_id)
    if not feedback_source:
        return None
    selected_feedback, feedback_prompt = feedback_source

    task_card_source = _load_task_card_source(path, manifest, task_card_id)
    if not task_card_source:
        return None
    task_card_prompt = task_card_source

    return (
        values["basePrompt"],
        {
            "dominant": values["dominantPrompt"],
            "collaborative": values["collaborativePrompt"],
        },
        selected_feedback,
        feedback_prompt,
        task_card_prompt,
    )


def load_default_prompt_config(
    task_card_id: str | None = None,
    feedback_condition_id: str | None = None,
) -> tuple[
    str,
    dict[AgentRole, str],
    FeedbackCondition,
    str,
    str,
]:
    config = _load_prompt_source_dir(DEFAULT_PROMPT_SOURCE_DIR, task_card_id, feedback_condition_id)
    if config is None:
        raise RuntimeError(
            f"Default realtime prompt source is missing or invalid: {DEFAULT_PROMPT_SOURCE_DIR}"
        )
    return config


def _resolved_prompt_from_tuple(
    config: tuple[
        str,
        dict[AgentRole, str],
        FeedbackCondition,
        str,
        str,
    ],
    *,
    source: PromptSource,
    prompt_version_id: str | None = None,
    saved_at: str | None = None,
    task_card_id: str | None = None,
) -> ResolvedRealtimePrompt:
    (
        base_prompt,
        role_prompts,
        selected_feedback,
        feedback_prompt,
        task_card_prompt,
    ) = config
    return ResolvedRealtimePrompt(
        base_prompt=base_prompt,
        role_prompts=role_prompts,
        feedback_condition=selected_feedback,
        feedback_prompt=feedback_prompt,
        condition_combination_prompts=normalize_condition_combination_prompts(None),
        task_card_prompt=task_card_prompt,
        source=source,
        prompt_version_id=prompt_version_id,
        saved_at=saved_at,
        task_card_id=task_card_id,
    )


def load_prompt_source(
    task_card_id: str | None = None,
    feedback_condition_id: str | None = None,
    prompt_version_id: str | None = None,
) -> ResolvedRealtimePrompt:
    if isinstance(prompt_version_id, str) and prompt_version_id.strip():
        return _load_prompt_version_source(prompt_version_id, feedback_condition_id)

    return _resolved_prompt_from_tuple(
        load_default_prompt_config(task_card_id, feedback_condition_id),
        source="default",
        task_card_id=task_card_id.strip()
        if isinstance(task_card_id, str) and task_card_id.strip()
        else _read_default_task_card_id(),
    )


def load_prompt_config(
    task_card_id: str | None = None,
    feedback_condition_id: str | None = None,
    prompt_version_id: str | None = None,
) -> tuple[
    str,
    dict[AgentRole, str],
    FeedbackCondition,
    str,
    str,
]:
    return load_prompt_source(
        task_card_id,
        feedback_condition_id,
        prompt_version_id,
    ).as_tuple()


def get_opening_sentence_from_source(source: ResolvedRealtimePrompt) -> str:
    return _extract_task_card_opening(source.task_card_prompt) or DEFAULT_OPENING_SENTENCE


def get_opening_sentence(
    task_card_id: str | None = None,
    feedback_condition_id: str | None = None,
    prompt_version_id: str | None = None,
) -> str:
    source = load_prompt_source(task_card_id, feedback_condition_id, prompt_version_id)
    return get_opening_sentence_from_source(source)


def build_prompt_from_source(
    source: ResolvedRealtimePrompt,
    participant_name: str | None = None,
    role: str | None = "dominant",
) -> str:
    agent_role = normalize_role(role)
    condition_prompt = source.condition_combination_prompts.get(
        _condition_combination_key(agent_role, source.feedback_condition),
        "",
    )
    chunks = [
        source.base_prompt,
        source.role_prompts[agent_role],
        source.feedback_prompt,
    ]
    if condition_prompt.strip():
        chunks.append(condition_prompt.strip())
    chunks.append(source.task_card_prompt)
    prompt = "\n\n".join(chunks)
    name = participant_name.strip() if participant_name else ""

    if name:
        prompt += (
            "\n\n# SESSION INFO\n"
            "This is a one-on-one call with one Korean 6th-grade EFL student.\n"
            f"Your friend's name is {name}.\n"
            f"You may use {name}'s name naturally.\n"
            f"Still invite {name} to say hello naturally at the start.\n"
            "Do not treat the displayed name as a replacement for talking together.\n"
        )

    return prompt


def build_prompt(
    participant_name: str | None = None,
    role: str | None = "dominant",
    task_card_id: str | None = None,
    feedback_condition_id: str | None = None,
    prompt_version_id: str | None = None,
) -> str:
    source = load_prompt_source(task_card_id, feedback_condition_id, prompt_version_id)
    return build_prompt_from_source(source, participant_name, role)
