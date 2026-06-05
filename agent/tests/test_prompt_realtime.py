import json

import prompt_realtime
from prompt_realtime import build_prompt, normalize_role


def _read_realtime_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["realtime"]


def _read_default_prompt_sources():
    source_dir = prompt_realtime.DEFAULT_PROMPT_SOURCE_DIR
    manifest = json.loads(prompt_realtime.PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    return {
        key: (source_dir / manifest[key]["file"]).read_text(encoding="utf-8").strip()
        for key in prompt_realtime.PROMPT_FIELDS
    }


def _expected_prompt(config, role: str) -> str:
    role_key = f"{role}Prompt"
    return f"{config['basePrompt']}\n\n{config[role_key]}\n\n{config['taskCardPrompt']}"


def test_realtime_prompt_builds_dominant_from_markdown_sources(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")
    config = _read_default_prompt_sources()

    assert build_prompt(role="dominant") == _expected_prompt(config, "dominant")


def test_realtime_prompt_builds_collaborative_from_markdown_sources(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")
    config = _read_default_prompt_sources()

    assert build_prompt(role="collaborative") == _expected_prompt(config, "collaborative")


def test_realtime_prompt_defaults_to_dominant_role(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    assert normalize_role("unknown") == "dominant"
    assert build_prompt(role="unknown") == build_prompt(role="dominant")


def test_realtime_prompt_maps_legacy_passive_to_collaborative(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    assert normalize_role("passive") == "collaborative"
    assert build_prompt(role="passive") == build_prompt(role="collaborative")


def test_realtime_prompt_adds_session_info_after_json_prompt(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")
    config = _read_default_prompt_sources()
    prompt_without_name = _expected_prompt(config, "collaborative")
    prompt_with_name = build_prompt("Junbo", role="collaborative")

    assert prompt_with_name.startswith(f"{prompt_without_name}\n\n# SESSION INFO\n")
    assert "Junbo" in prompt_with_name


def test_realtime_prompt_defaults_live_only_in_markdown_sources() -> None:
    assert not hasattr(prompt_realtime, "BASE_PROMPT")
    assert not hasattr(prompt_realtime, "ROLE_PROMPTS")
    assert not hasattr(prompt_realtime, "TASK_CARD_PROMPT")


def test_realtime_prompt_uses_runtime_config(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "prompt_config.json"
    config_path.write_text(
        """
        {
          "realtime": {
            "basePrompt": "Runtime base prompt.",
            "dominantPrompt": "Runtime dominant role.",
            "collaborativePrompt": "Runtime collaborative role.",
            "taskCardPrompt": "Runtime task card."
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", config_path)
    config = _read_realtime_config(config_path)

    assert build_prompt(role="dominant") == _expected_prompt(config, "dominant")
    assert build_prompt(role="collaborative") == _expected_prompt(config, "collaborative")


def test_realtime_prompt_uses_legacy_passive_prompt_runtime_config(
    tmp_path, monkeypatch
) -> None:
    config_path = tmp_path / "prompt_config.json"
    config_path.write_text(
        """
        {
          "realtime": {
            "basePrompt": "Runtime base prompt.",
            "dominantPrompt": "Runtime dominant role.",
            "passivePrompt": "Runtime passive role.",
            "taskCardPrompt": "Runtime task card."
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", config_path)

    assert build_prompt(role="collaborative") == (
        "Runtime base prompt.\n\nRuntime passive role.\n\nRuntime task card."
    )


def test_realtime_prompt_runtime_config_overrides_markdown_sources(
    tmp_path, monkeypatch
) -> None:
    config_path = tmp_path / "prompt_config.json"
    config_path.write_text(
        """
        {
          "realtime": {
            "basePrompt": "Runtime base prompt.",
            "dominantPrompt": "Runtime dominant role.",
            "collaborativePrompt": "Runtime collaborative role.",
            "taskCardPrompt": "Runtime task card."
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", config_path)

    prompt = build_prompt(role="dominant")

    assert prompt == "Runtime base prompt.\n\nRuntime dominant role.\n\nRuntime task card."
    assert prompt != _expected_prompt(_read_default_prompt_sources(), "dominant")


def test_realtime_prompt_missing_default_source_fails(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_SOURCE_DIR", tmp_path / "missing")
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    try:
        build_prompt(role="dominant")
    except RuntimeError as exc:
        assert "Default realtime prompt source is missing or invalid" in str(exc)
    else:
        raise AssertionError("expected missing default prompt source to fail")
