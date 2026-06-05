import json
from pathlib import Path
from typing import Literal


AgentRole = Literal["dominant", "collaborative"]
PROMPT_CONFIG_PATH = Path(__file__).parent.parent / "prompt_config.json"
DEFAULT_PROMPT_SOURCE_DIR = Path(__file__).parent.parent / "prompts" / "realtime"
PROMPT_SOURCE_MANIFEST_PATH = DEFAULT_PROMPT_SOURCE_DIR / "manifest.json"
PROMPT_FIELDS = ("basePrompt", "dominantPrompt", "collaborativePrompt", "taskCardPrompt")


def normalize_role(role: str | None = None) -> AgentRole:
    if role in ("collaborative", "passive"):
        return "collaborative"
    return "dominant"


def _valid_prompt_text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _load_prompt_config_file(path: Path) -> tuple[str, dict[AgentRole, str], str] | None:
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
    task_card_prompt = _valid_prompt_text(realtime.get("taskCardPrompt"))

    if not all((base_prompt, dominant_prompt, collaborative_prompt, task_card_prompt)):
        return None

    return (
        base_prompt,
        {
            "dominant": dominant_prompt,
            "collaborative": collaborative_prompt,
        },
        task_card_prompt,
    )


def _load_prompt_source_dir(path: Path) -> tuple[str, dict[AgentRole, str], str] | None:
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

    return (
        values["basePrompt"],
        {
            "dominant": values["dominantPrompt"],
            "collaborative": values["collaborativePrompt"],
        },
        values["taskCardPrompt"],
    )


def load_default_prompt_config() -> tuple[str, dict[AgentRole, str], str]:
    config = _load_prompt_source_dir(DEFAULT_PROMPT_SOURCE_DIR)
    if config is None:
        raise RuntimeError(
            f"Default realtime prompt source is missing or invalid: {DEFAULT_PROMPT_SOURCE_DIR}"
        )
    return config


def load_prompt_config() -> tuple[str, dict[AgentRole, str], str]:
    default_config = load_default_prompt_config()
    return _load_prompt_config_file(PROMPT_CONFIG_PATH) or default_config


def build_prompt(
    participant_name: str | None = None,
    role: str | None = "dominant",
) -> str:
    base_prompt, role_prompts, task_card_prompt = load_prompt_config()
    agent_role = normalize_role(role)
    prompt = f"{base_prompt}\n\n{role_prompts[agent_role]}\n\n{task_card_prompt}"
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
