import json
from pathlib import Path
from typing import Literal


AgentRole = Literal["dominant", "collaborative"]
ConversationExamples = dict[AgentRole, str]
DEFAULT_OPENING_SENTENCE = (
    "Hi, I'm Daisy. Let's talk about today's task together. What is your name?"
)
PROMPT_CONFIG_PATH = Path(__file__).parent.parent / "prompt_config.json"
DEFAULT_PROMPT_SOURCE_DIR = Path(__file__).parent.parent / "prompts" / "realtime"
PROMPT_SOURCE_MANIFEST_PATH = DEFAULT_PROMPT_SOURCE_DIR / "manifest.json"
PROMPT_FIELDS = ("basePrompt", "dominantPrompt", "collaborativePrompt")
LEGACY_PROMPT_FIELDS = (*PROMPT_FIELDS, "taskCardPrompt")


def normalize_role(role: str | None = None) -> AgentRole:
    if role in ("collaborative", "passive"):
        return "collaborative"
    return "dominant"


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


def _load_task_card_examples(source_dir: Path, entry: dict) -> ConversationExamples | None:
    examples = entry.get("examples")
    if examples is None:
        return {}
    if not isinstance(examples, dict):
        return None

    loaded: ConversationExamples = {}
    for role in ("dominant", "collaborative"):
        example = examples.get(role)
        if example is None:
            continue
        if not isinstance(example, dict):
            return None
        filename = example.get("file")
        marker = example.get("marker")
        if not isinstance(filename, str) or not isinstance(marker, str):
            return None
        try:
            value = (source_dir / "task-cards" / filename).read_text(encoding="utf-8").strip()
        except OSError:
            return None
        if not value or not value.startswith(marker):
            return None
        loaded[role] = value
    return loaded


def _load_task_card_source(
    source_dir: Path,
    manifest: dict,
    task_card_id: str | None = None,
) -> tuple[str, ConversationExamples] | None:
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
        return (value, {}) if value and value.startswith(marker) else None

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
    examples = _load_task_card_examples(source_dir, entry)
    if examples is None:
        return None
    return value, examples


def _load_prompt_config_file(
    path: Path,
    task_card_id: str | None = None,
) -> tuple[str, dict[AgentRole, str], str, ConversationExamples] | None:
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None

    realtime = raw.get("realtime") if isinstance(raw, dict) else None
    if not isinstance(realtime, dict):
        return None

    base_prompt = _valid_prompt_text(realtime.get("basePrompt"))
    dominant_prompt = _valid_prompt_text(realtime.get("dominantPrompt"))
    collaborative_prompt = _valid_prompt_text(
        realtime.get("collaborativePrompt", realtime.get("passivePrompt"))
    )
    configured_task_card_id = realtime.get("taskCardId")
    selected_task_card_id = task_card_id or (
        configured_task_card_id if isinstance(configured_task_card_id, str) else None
    )
    task_card_prompt = (
        None
        if selected_task_card_id
        else _valid_prompt_text(realtime.get("taskCardPrompt"))
    )

    if (
        not task_card_prompt
        and isinstance(selected_task_card_id, str)
        and selected_task_card_id.strip()
    ):
        try:
            manifest = json.loads(PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if isinstance(manifest, dict):
            task_card_source = _load_task_card_source(
                DEFAULT_PROMPT_SOURCE_DIR,
                manifest,
                selected_task_card_id.strip(),
            )
            if task_card_source:
                task_card_prompt, conversation_examples = task_card_source
            else:
                conversation_examples = {}
        else:
            conversation_examples = {}
    else:
        conversation_examples = {}

    if not all((base_prompt, dominant_prompt, collaborative_prompt, task_card_prompt)):
        return None

    return (
        base_prompt,
        {
            "dominant": dominant_prompt,
            "collaborative": collaborative_prompt,
        },
        task_card_prompt,
        conversation_examples,
    )


def _load_prompt_source_dir(
    path: Path,
    task_card_id: str | None = None,
) -> tuple[str, dict[AgentRole, str], str, ConversationExamples] | None:
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

    task_card_source = _load_task_card_source(path, manifest, task_card_id)
    if not task_card_source:
        return None
    task_card_prompt, conversation_examples = task_card_source

    return (
        values["basePrompt"],
        {
            "dominant": values["dominantPrompt"],
            "collaborative": values["collaborativePrompt"],
        },
        task_card_prompt,
        conversation_examples,
    )


def load_default_prompt_config(
    task_card_id: str | None = None,
) -> tuple[str, dict[AgentRole, str], str, ConversationExamples]:
    config = _load_prompt_source_dir(DEFAULT_PROMPT_SOURCE_DIR, task_card_id)
    if config is None:
        raise RuntimeError(
            f"Default realtime prompt source is missing or invalid: {DEFAULT_PROMPT_SOURCE_DIR}"
        )
    return config


def load_prompt_config(
    task_card_id: str | None = None,
) -> tuple[str, dict[AgentRole, str], str, ConversationExamples]:
    default_config = load_default_prompt_config(task_card_id)
    return _load_prompt_config_file(PROMPT_CONFIG_PATH, task_card_id) or default_config


def get_opening_sentence(task_card_id: str | None = None) -> str:
    _, _, task_card_prompt, _ = load_prompt_config(task_card_id)
    return _extract_task_card_opening(task_card_prompt) or DEFAULT_OPENING_SENTENCE


def build_prompt(
    participant_name: str | None = None,
    role: str | None = "dominant",
    task_card_id: str | None = None,
) -> str:
    base_prompt, role_prompts, task_card_prompt, conversation_examples = load_prompt_config(
        task_card_id
    )
    agent_role = normalize_role(role)
    prompt = f"{base_prompt}\n\n{role_prompts[agent_role]}\n\n{task_card_prompt}"
    conversation_example = conversation_examples.get(agent_role)
    if conversation_example:
        prompt += f"\n\n{conversation_example}"
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
