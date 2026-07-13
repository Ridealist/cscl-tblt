#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_PATH = REPO_ROOT / "prompts" / "realtime"
PROMPT_FIELDS = (
    "basePrompt",
    "dominantPrompt",
    "collaborativePrompt",
)
CONDITION_COMBINATION_PROMPT_KEYS = (
    "dominant_no_feedback",
    "dominant_explicit_correction",
    "collaborative_no_feedback",
    "collaborative_explicit_correction",
)
LEGACY_PROMPT_FIELDS = (
    *PROMPT_FIELDS,
    "taskCardPrompt",
)


def read_manifest(path):
    try:
        manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Prompt manifest is not readable: {path / 'manifest.json'}") from exc
    if not isinstance(manifest, dict):
        raise ValueError("Prompt manifest must be a JSON object.")

    entries = {}
    for key in PROMPT_FIELDS:
        entry = manifest.get(key)
        if not isinstance(entry, dict):
            raise ValueError(f"Prompt manifest is missing an object entry for {key}.")
        filename = entry.get("file")
        marker = entry.get("marker")
        if not isinstance(filename, str) or not filename:
            raise ValueError(f"Prompt manifest entry {key}.file must be a string.")
        if not isinstance(marker, str) or not marker:
            raise ValueError(f"Prompt manifest entry {key}.marker must be a string.")
        entries[key] = {"file": filename, "marker": marker}

    legacy_task_card = manifest.get("taskCardPrompt")
    if isinstance(legacy_task_card, dict):
        filename = legacy_task_card.get("file")
        marker = legacy_task_card.get("marker")
        if not isinstance(filename, str) or not filename:
            raise ValueError("Prompt manifest entry taskCardPrompt.file must be a string.")
        if not isinstance(marker, str) or not marker:
            raise ValueError("Prompt manifest entry taskCardPrompt.marker must be a string.")
        entries["taskCardPrompt"] = {"file": filename, "marker": marker}
        return entries

    task_card_manifest = manifest.get("taskCardManifest")
    default_task_card_id = manifest.get("defaultTaskCardId")
    feedback_condition_manifest = manifest.get("feedbackConditionManifest")
    default_feedback_condition_id = manifest.get("defaultFeedbackConditionId")
    condition_combination_manifest = manifest.get("conditionCombinationManifest")
    character_manifest = manifest.get("characterManifest")
    if not isinstance(feedback_condition_manifest, str) or not feedback_condition_manifest:
        raise ValueError("Prompt manifest entry feedbackConditionManifest must be a string.")
    if not isinstance(default_feedback_condition_id, str) or not default_feedback_condition_id:
        raise ValueError("Prompt manifest entry defaultFeedbackConditionId must be a string.")
    if not isinstance(condition_combination_manifest, str) or not condition_combination_manifest:
        raise ValueError("Prompt manifest entry conditionCombinationManifest must be a string.")
    if not isinstance(task_card_manifest, str) or not task_card_manifest:
        raise ValueError("Prompt manifest entry taskCardManifest must be a string.")
    if not isinstance(default_task_card_id, str) or not default_task_card_id:
        raise ValueError("Prompt manifest entry defaultTaskCardId must be a string.")
    entries["feedbackConditionManifest"] = feedback_condition_manifest
    entries["defaultFeedbackConditionId"] = default_feedback_condition_id
    entries["conditionCombinationManifest"] = condition_combination_manifest
    if isinstance(character_manifest, str) and character_manifest:
        entries["characterManifest"] = character_manifest
    entries["taskCardManifest"] = task_card_manifest
    entries["defaultTaskCardId"] = default_task_card_id
    return entries


def read_feedback_condition_manifest(path, manifest):
    manifest_file = manifest.get("feedbackConditionManifest")
    if not isinstance(manifest_file, str):
        return None
    feedback_manifest_path = path / manifest_file
    try:
        feedbacks = json.loads(feedback_manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Feedback condition manifest is not readable: {feedback_manifest_path}") from exc
    if not isinstance(feedbacks, dict) or not feedbacks:
        raise ValueError("Feedback condition manifest must be a non-empty JSON object.")

    entries = {}
    for feedback_id, entry in feedbacks.items():
        if not isinstance(feedback_id, str) or not feedback_id:
            raise ValueError("Feedback condition id must be a non-empty string.")
        if not isinstance(entry, dict):
            raise ValueError(f"Feedback condition manifest entry must be an object: {feedback_id}")
        filename = entry.get("file")
        marker = entry.get("marker")
        if not isinstance(filename, str) or not filename:
            raise ValueError(f"Feedback condition {feedback_id}.file must be a string.")
        if not isinstance(marker, str) or not marker:
            raise ValueError(f"Feedback condition {feedback_id}.marker must be a string.")
        entries[feedback_id] = {
            "file": filename,
            "marker": marker,
            "base_path": feedback_manifest_path.parent,
        }
    return entries


def read_task_card_manifest(path, manifest):
    manifest_file = manifest.get("taskCardManifest")
    if not isinstance(manifest_file, str):
        return None
    task_card_manifest_path = path / manifest_file
    try:
        task_cards = json.loads(task_card_manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Task card manifest is not readable: {task_card_manifest_path}") from exc
    if not isinstance(task_cards, dict) or not task_cards:
        raise ValueError("Task card manifest must be a non-empty JSON object.")

    entries = {}
    for task_card_id, entry in task_cards.items():
        if not isinstance(task_card_id, str) or not task_card_id:
            raise ValueError("Task card id must be a non-empty string.")
        if not isinstance(entry, dict):
            raise ValueError(f"Task card manifest entry must be an object: {task_card_id}")
        filename = entry.get("file")
        marker = entry.get("marker")
        if not isinstance(filename, str) or not filename:
            raise ValueError(f"Task card {task_card_id}.file must be a string.")
        if not isinstance(marker, str) or not marker:
            raise ValueError(f"Task card {task_card_id}.marker must be a string.")
        entries[task_card_id] = {
            "file": filename,
            "marker": marker,
            "characterId": entry.get("characterId"),
            "base_path": task_card_manifest_path.parent,
        }
    return entries


def read_character_manifest(path, manifest):
    manifest_file = manifest.get("characterManifest")
    if not isinstance(manifest_file, str):
        return None
    character_manifest_path = path / manifest_file
    try:
        characters = json.loads(character_manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Character manifest is not readable: {character_manifest_path}") from exc
    if not isinstance(characters, dict) or not characters:
        raise ValueError("Character manifest must be a non-empty JSON object.")
    required = ("displayName", "avatarSrc", "voiceId", "ttsSpeed", "ttsVolume")
    for character_id, entry in characters.items():
        if not isinstance(character_id, str) or not isinstance(entry, dict):
            raise ValueError("Character manifest entries must be named objects.")
        for field in required:
            value = entry.get(field)
            if field in ("ttsSpeed", "ttsVolume"):
                valid = isinstance(value, (int, float))
            else:
                valid = isinstance(value, str) and bool(value)
            if not valid:
                raise ValueError(f"Character {character_id}.{field} is invalid.")
    return characters


def read_condition_combination_manifest(path, manifest):
    manifest_file = manifest.get("conditionCombinationManifest")
    if not isinstance(manifest_file, str):
        return None
    condition_manifest_path = path / manifest_file
    try:
        combinations = json.loads(condition_manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(
            f"Condition combination manifest is not readable: {condition_manifest_path}"
        ) from exc
    if not isinstance(combinations, dict) or not combinations:
        raise ValueError("Condition combination manifest must be a non-empty JSON object.")

    entries = {}
    for key in CONDITION_COMBINATION_PROMPT_KEYS:
        entry = combinations.get(key)
        if not isinstance(entry, dict):
            raise ValueError(f"Condition combination manifest is missing an object entry for {key}.")
        filename = entry.get("file")
        marker = entry.get("marker")
        if not isinstance(filename, str) or not filename:
            raise ValueError(f"Condition combination {key}.file must be a string.")
        if not isinstance(marker, str) or not marker:
            raise ValueError(f"Condition combination {key}.marker must be a string.")
        entries[key] = {
            "file": filename,
            "marker": marker,
            "base_path": condition_manifest_path.parent,
        }
    return entries


def parse_prompt_source(text, manifest):
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    legacy_manifest = {
        **manifest,
        "taskCardPrompt": manifest.get(
            "taskCardPrompt",
            {"file": "task_card.md", "marker": "# TASK CARD:"},
        ),
    }

    matches = []
    for key in LEGACY_PROMPT_FIELDS:
        pattern = re.compile(rf"^{re.escape(legacy_manifest[key]['marker'])}", re.MULTILINE)
        match = pattern.search(text)
        if match is None:
            raise ValueError(
                f"Missing prompt section marker for {key}: {legacy_manifest[key]['marker']}"
            )
        matches.append((key, match.start()))

    starts = [start for _, start in matches]
    if starts != sorted(starts):
        ordered = ", ".join(LEGACY_PROMPT_FIELDS)
        raise ValueError(f"Prompt sections must appear in this order: {ordered}")

    realtime = {}
    for index, (key, start) in enumerate(matches):
        end = matches[index + 1][1] if index + 1 < len(matches) else len(text)
        value = text[start:end].strip()
        if not value:
            raise ValueError(f"Prompt section is empty: {key}")
        realtime[key] = value

    return {"realtime": realtime}


def read_prompt_folder(path):
    manifest = read_manifest(path)
    realtime = {}
    for key in PROMPT_FIELDS:
        filename = manifest[key]["file"]
        marker = manifest[key]["marker"]
        prompt_path = path / filename
        try:
            value = prompt_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ValueError(f"Prompt source file is not readable: {prompt_path}") from exc
        if not value:
            raise ValueError(f"Prompt source file is empty: {prompt_path}")
        if not value.startswith(marker):
            raise ValueError(f"Prompt source file {prompt_path} must start with {marker!r}")
        realtime[key] = value

    if "taskCardPrompt" in manifest:
        filename = manifest["taskCardPrompt"]["file"]
        marker = manifest["taskCardPrompt"]["marker"]
        prompt_path = path / filename
        try:
            value = prompt_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ValueError(f"Prompt source file is not readable: {prompt_path}") from exc
        if not value:
            raise ValueError(f"Prompt source file is empty: {prompt_path}")
        if not value.startswith(marker):
            raise ValueError(f"Prompt source file {prompt_path} must start with {marker!r}")
        realtime["taskCardPrompt"] = value
        return {"realtime": realtime}

    feedback_conditions = read_feedback_condition_manifest(path, manifest)
    default_feedback_condition_id = manifest["defaultFeedbackConditionId"]
    if default_feedback_condition_id not in feedback_conditions:
        raise ValueError(
            f"defaultFeedbackConditionId is not registered: {default_feedback_condition_id}"
        )
    for feedback_id, entry in feedback_conditions.items():
        prompt_path = entry["base_path"] / entry["file"]
        try:
            value = prompt_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ValueError(f"Feedback condition source file is not readable: {prompt_path}") from exc
        if not value:
            raise ValueError(f"Feedback condition source file is empty: {prompt_path}")
        if not value.startswith(entry["marker"]):
            raise ValueError(
                f"Feedback condition source file {prompt_path} must start with {entry['marker']!r}"
            )
        if feedback_id == default_feedback_condition_id:
            realtime["feedbackConditionId"] = feedback_id
            realtime["feedbackPrompt"] = value

    condition_combination_prompts = {}
    for key, entry in read_condition_combination_manifest(path, manifest).items():
        prompt_path = entry["base_path"] / entry["file"]
        try:
            value = prompt_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ValueError(
                f"Condition combination source file is not readable: {prompt_path}"
            ) from exc
        if not value:
            raise ValueError(f"Condition combination source file is empty: {prompt_path}")
        if not value.startswith(entry["marker"]):
            raise ValueError(
                f"Condition combination source file {prompt_path} must start with {entry['marker']!r}"
            )
        condition_combination_prompts[key] = value
    realtime["conditionCombinationPrompts"] = condition_combination_prompts

    task_cards = read_task_card_manifest(path, manifest)
    characters = read_character_manifest(path, manifest)
    if characters is not None:
        for task_card_id, entry in task_cards.items():
            character_id = entry.get("characterId")
            if not isinstance(character_id, str) or character_id not in characters:
                raise ValueError(
                    f"Task card {task_card_id} has an unregistered characterId: {character_id}"
                )
    default_task_card_id = manifest["defaultTaskCardId"]
    if default_task_card_id not in task_cards:
        raise ValueError(f"defaultTaskCardId is not registered: {default_task_card_id}")
    for task_card_id, entry in task_cards.items():
        prompt_path = entry["base_path"] / entry["file"]
        try:
            value = prompt_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ValueError(f"Task card source file is not readable: {prompt_path}") from exc
        if not value:
            raise ValueError(f"Task card source file is empty: {prompt_path}")
        if not value.startswith(entry["marker"]):
            raise ValueError(
                f"Task card source file {prompt_path} must start with {entry['marker']!r}"
            )
        if task_card_id == default_task_card_id:
            realtime["taskCardId"] = task_card_id
            realtime["taskCardPrompt"] = value
    return {"realtime": realtime}


def read_prompt_source(path):
    if path.is_dir():
        return read_prompt_folder(path)
    return parse_prompt_source(
        path.read_text(encoding="utf-8"),
        read_manifest(DEFAULT_SOURCE_PATH),
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Validate realtime prompt Markdown sources."
    )
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        default=DEFAULT_SOURCE_PATH,
        help="Prompt source directory or pasted text file. Defaults to prompts/realtime.",
    )
    args = parser.parse_args(argv)

    try:
        read_prompt_source(args.source)
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc

    return 0


if __name__ == "__main__":
    sys.exit(main())
