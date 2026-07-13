import json
import os
import re
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
    "dominant_no_feedback",
    "dominant_explicit_correction",
    "collaborative_no_feedback",
    "collaborative_explicit_correction",
)
CONDITION_COMBINATION_PROMPT_ALIASES = {
    "dominant_no_feedback": ("dominant_no_corrective",),
    "collaborative_no_feedback": ("collaborative_no_corrective",),
}
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
        "task_character",
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
    character_id: str = "kate"
    character_name: str = "Kate"
    character_avatar_src: str = "/agents/kate_photo_20260615.png"
    character_voice_id: str = "b7d50908-b17c-442d-ad8d-810c63997ed9"
    character_tts_speed: float = 0.8
    character_tts_volume: float = 1.1
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
    prompts: dict[str, str] = {}
    for key in CONDITION_COMBINATION_PROMPT_KEYS:
        candidates = (key, *CONDITION_COMBINATION_PROMPT_ALIASES.get(key, ()))
        prompt = next(
            (
                source[candidate].strip()
                for candidate in candidates
                if isinstance(source.get(candidate), str) and source[candidate].strip()
            ),
            "",
        )
        prompts[key] = prompt
    return prompts


def _load_task_character(
    source_dir: Path,
    task_card_id: str | None,
) -> dict[str, object]:
    fallback = {
        "id": "kate",
        "display_name": "Kate",
        "avatar_src": "/agents/kate_photo_20260615.png",
        "voice_id": "b7d50908-b17c-442d-ad8d-810c63997ed9",
        "tts_speed": 0.8,
        "tts_volume": 1.1,
    }
    try:
        manifest = json.loads((source_dir / "manifest.json").read_text(encoding="utf-8"))
        task_manifest_file = manifest.get("taskCardManifest", "task-cards/manifest.json")
        character_manifest_file = manifest.get(
            "characterManifest", "characters/manifest.json"
        )
        selected_task_id = task_card_id or manifest.get("defaultTaskCardId")
        task_cards = json.loads((source_dir / task_manifest_file).read_text(encoding="utf-8"))
        characters = json.loads(
            (source_dir / character_manifest_file).read_text(encoding="utf-8")
        )
        task_entry = task_cards.get(selected_task_id, {})
        character_id = task_entry.get("characterId", "kate")
        character = characters.get(character_id)
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        return fallback
    if not isinstance(character_id, str) or not isinstance(character, dict):
        return fallback

    def text_value(key: str, default: str) -> str:
        value = character.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else default

    def number_value(key: str, default: float) -> float:
        value = character.get(key)
        return float(value) if isinstance(value, (int, float)) else default

    return {
        "id": character_id,
        "display_name": text_value("displayName", str(fallback["display_name"])),
        "avatar_src": text_value("avatarSrc", str(fallback["avatar_src"])),
        "voice_id": text_value("voiceId", str(fallback["voice_id"])),
        "tts_speed": number_value("ttsSpeed", float(fallback["tts_speed"])),
        "tts_volume": number_value("ttsVolume", float(fallback["tts_volume"])),
    }


def _normalize_task_character(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    required_text = ("id", "displayName", "avatarSrc", "voiceId")
    if any(not isinstance(value.get(key), str) or not value[key].strip() for key in required_text):
        return None
    if not isinstance(value.get("ttsSpeed"), (int, float)) or not isinstance(
        value.get("ttsVolume"), (int, float)
    ):
        return None
    return {
        "id": value["id"].strip(),
        "display_name": value["displayName"].strip(),
        "avatar_src": value["avatarSrc"].strip(),
        "voice_id": value["voiceId"].strip(),
        "tts_speed": float(value["ttsSpeed"]),
        "tts_volume": float(value["ttsVolume"]),
    }


def _infer_task_character_from_prompt(prompt: str) -> str | None:
    section_match = re.search(
        r"^#+\s+Character Information\s*$([\s\S]*?)(?=^#|\Z)",
        prompt,
        re.IGNORECASE | re.MULTILINE,
    )
    if section_match:
        name_match = re.search(
            r"^\s*[*-]\s*Name:\s*(Kate|Jack)\s*$",
            section_match.group(1),
            re.IGNORECASE | re.MULTILINE,
        )
        if name_match:
            return name_match.group(1).lower()
    opening_match = re.search(
        r"^#\s+Opening\s*$[\s\S]*?\bI(?:'|’|\s+a)m\s+(Kate|Jack)\b",
        prompt,
        re.IGNORECASE | re.MULTILINE,
    )
    return opening_match.group(1).lower() if opening_match else None


def _resolve_task_character_snapshot(
    value: object,
    task_card_prompt: str,
    task_card_id: str | None,
) -> dict[str, object]:
    stored = _normalize_task_character(value)
    if stored:
        return stored
    inferred_id = _infer_task_character_from_prompt(task_card_prompt)
    if inferred_id:
        inferred = _load_task_character_for_id(DEFAULT_PROMPT_SOURCE_DIR, inferred_id)
        if inferred:
            return inferred
    return _load_task_character(DEFAULT_PROMPT_SOURCE_DIR, task_card_id)


def _load_task_character_for_id(
    source_dir: Path,
    character_id: str,
) -> dict[str, object] | None:
    try:
        manifest = json.loads((source_dir / "manifest.json").read_text(encoding="utf-8"))
        character_manifest_file = manifest.get(
            "characterManifest", "characters/manifest.json"
        )
        characters = json.loads(
            (source_dir / character_manifest_file).read_text(encoding="utf-8")
        )
        source = characters.get(character_id)
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        return None
    if not isinstance(source, dict):
        return None
    return _normalize_task_character({"id": character_id, **source})


def _condition_combination_feedback_suffix(feedback: str | None) -> str:
    if normalize_feedback_condition(feedback) == "explicit_correction":
        return "explicit_correction"
    return "no_feedback"


def _condition_combination_key(
    role: str | None,
    feedback: str | None,
) -> str:
    return f"{normalize_role(role)}_{_condition_combination_feedback_suffix(feedback)}"


def _feedback_condition_label(feedback: str | None) -> str:
    return (
        "Explicit Correction"
        if normalize_feedback_condition(feedback) == "explicit_correction"
        else "No Feedback"
    )


def _condition_combination_title(role: str | None, feedback: str | None) -> str:
    return f"{normalize_role(role).title()} + {_feedback_condition_label(feedback)}"


def _valid_prompt_text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _strip_obsolete_prompt_stack_lines(prompt: str) -> str:
    lines = [
        line
        for line in prompt.splitlines()
        if line.strip() != "4. ONE Conversation Example, when available"
    ]
    return "\n".join(lines).strip()


def _extract_task_card_opening(task_card_prompt: str) -> str | None:
    lines = task_card_prompt.splitlines()
    for index, line in enumerate(lines):
        if line.strip().lower() != "# opening":
            continue

        opening_lines = []
        started = False
        for candidate in lines[index + 1 :]:
            stripped = candidate.strip()
            if stripped.startswith("#"):
                break
            if not stripped:
                if started:
                    break
                continue
            opening_lines.append(stripped)
            started = True
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


def _load_condition_combination_source(source_dir: Path, manifest: dict) -> dict[str, str] | None:
    manifest_file = manifest.get("conditionCombinationManifest")
    if not isinstance(manifest_file, str) or not manifest_file:
        return None

    try:
        combinations = json.loads((source_dir / manifest_file).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(combinations, dict):
        return None

    values: dict[str, str] = {}
    base_path = (source_dir / manifest_file).parent
    for key in CONDITION_COMBINATION_PROMPT_KEYS:
        entry = combinations.get(key)
        if not isinstance(entry, dict):
            return None
        filename = entry.get("file")
        marker = entry.get("marker")
        if not isinstance(filename, str) or not isinstance(marker, str):
            return None
        try:
            value = (base_path / filename).read_text(encoding="utf-8").strip()
        except OSError:
            return None
        if not value or not value.startswith(marker):
            return None
        values[key] = value
    return values


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
    saved_at = row.get("created_at")

    if not all(
        (
            base_prompt,
            dominant_prompt,
            collaborative_prompt,
            task_card_prompt,
        )
    ):
        raise PromptVersionFetchError(
            f"Prompt version row is missing required prompt fields: {resolved_version_id}"
        )

    character = _resolve_task_character_snapshot(
        row.get("task_character"),
        task_card_prompt,
        resolved_task_card_id,
    )
    return ResolvedRealtimePrompt(
        base_prompt=_strip_obsolete_prompt_stack_lines(base_prompt),
        role_prompts={
            "dominant": dominant_prompt,
            "collaborative": collaborative_prompt,
        },
        feedback_condition=selected_feedback,
        feedback_prompt=feedback_prompt or "",
        condition_combination_prompts=normalize_condition_combination_prompts(
            row.get("condition_combination_prompts")
        ),
        task_card_prompt=task_card_prompt,
        character_id=str(character["id"]),
        character_name=str(character["display_name"]),
        character_avatar_src=str(character["avatar_src"]),
        character_voice_id=str(character["voice_id"]),
        character_tts_speed=float(character["tts_speed"]),
        character_tts_volume=float(character["tts_volume"]),
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
    dict[str, str],
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
        if key == "basePrompt":
            values[key] = _strip_obsolete_prompt_stack_lines(values[key])

    feedback_source = _load_feedback_source(path, manifest, feedback_condition_id)
    if not feedback_source:
        return None
    selected_feedback, feedback_prompt = feedback_source

    condition_combination_prompts = _load_condition_combination_source(path, manifest)
    if condition_combination_prompts is None:
        return None

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
        condition_combination_prompts,
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
    dict[str, str],
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
        dict[str, str],
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
        condition_combination_prompts,
        task_card_prompt,
    ) = config
    character = _load_task_character(DEFAULT_PROMPT_SOURCE_DIR, task_card_id)
    return ResolvedRealtimePrompt(
        base_prompt=base_prompt,
        role_prompts=role_prompts,
        feedback_condition=selected_feedback,
        feedback_prompt=feedback_prompt,
        condition_combination_prompts=normalize_condition_combination_prompts(
            condition_combination_prompts
        ),
        task_card_prompt=task_card_prompt,
        character_id=str(character["id"]),
        character_name=str(character["display_name"]),
        character_avatar_src=str(character["avatar_src"]),
        character_voice_id=str(character["voice_id"]),
        character_tts_speed=float(character["tts_speed"]),
        character_tts_volume=float(character["tts_volume"]),
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

    resolved_task_card_id = (
        task_card_id.strip()
        if isinstance(task_card_id, str) and task_card_id.strip()
        else _read_default_task_card_id()
    )
    return _resolved_prompt_from_tuple(
        load_default_prompt_config(task_card_id, feedback_condition_id),
        source="default",
        task_card_id=resolved_task_card_id,
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


def build_prompt_stack_from_source(
    source: ResolvedRealtimePrompt,
    participant_name: str | None = None,
    role: str | None = "dominant",
) -> dict:
    agent_role = normalize_role(role)
    condition_key = _condition_combination_key(agent_role, source.feedback_condition)
    condition_prompt = source.condition_combination_prompts.get(condition_key, "").strip()
    name = participant_name.strip() if participant_name else ""
    chunks = [
        {
            "id": "base",
            "title": "Base Prompt",
            "content": source.base_prompt,
        },
        {
            "id": f"role:{agent_role}",
            "title": f"Interlocutor Role Prompt: {agent_role}",
            "content": source.role_prompts[agent_role],
        },
    ]
    if condition_prompt:
        chunks.append(
            {
                "id": f"condition_combination:{condition_key}",
                "title": (
                    "Condition Combination Prompt: "
                    f"{_condition_combination_title(agent_role, source.feedback_condition)}"
                ),
                "content": condition_prompt,
            }
        )
    chunks.append(
        {
            "id": f"task_card:{source.task_card_id or 'unknown'}",
            "title": f"Task Card: {source.task_card_id or 'unknown'}",
            "content": source.task_card_prompt,
        }
    )

    return {
        "schema_version": 1,
        "mode": "realtime_practice",
        "source": source.source,
        "prompt_version_id": source.prompt_version_id,
        "saved_at": source.saved_at,
        "agent_role": agent_role,
        "feedback_condition_id": source.feedback_condition,
        "feedback_condition_label": _feedback_condition_label(source.feedback_condition),
        "condition_combination_key": condition_key,
        "condition_combination_title": _condition_combination_title(
            agent_role,
            source.feedback_condition,
        ),
        "task_card_id": source.task_card_id,
        "character_id": source.character_id,
        "character_name": source.character_name,
        "task_character": {
            "id": source.character_id,
            "displayName": source.character_name,
            "avatarSrc": source.character_avatar_src,
            "voiceId": source.character_voice_id,
            "ttsSpeed": source.character_tts_speed,
            "ttsVolume": source.character_tts_volume,
        },
        "participant_name": name or None,
        "stack_order": [chunk["id"] for chunk in chunks],
        "chunks": chunks,
        "final_prompt": build_prompt_from_source(source, participant_name, role),
    }


def build_prompt(
    participant_name: str | None = None,
    role: str | None = "dominant",
    task_card_id: str | None = None,
    feedback_condition_id: str | None = None,
    prompt_version_id: str | None = None,
) -> str:
    source = load_prompt_source(task_card_id, feedback_condition_id, prompt_version_id)
    return build_prompt_from_source(source, participant_name, role)
