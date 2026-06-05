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
    return entries


def parse_prompt_source(text, manifest):
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")

    matches = []
    for key in PROMPT_FIELDS:
        pattern = re.compile(rf"^{re.escape(manifest[key]['marker'])}", re.MULTILINE)
        match = pattern.search(text)
        if match is None:
            raise ValueError(f"Missing prompt section marker for {key}: {manifest[key]['marker']}")
        matches.append((key, match.start()))

    starts = [start for _, start in matches]
    if starts != sorted(starts):
        ordered = ", ".join(PROMPT_FIELDS)
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
