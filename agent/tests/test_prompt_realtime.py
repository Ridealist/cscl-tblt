import json

import prompt_realtime
from prompt_realtime import build_prompt, get_opening_sentence, normalize_role


def _read_realtime_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["realtime"]


def _read_default_prompt_sources():
    source_dir = prompt_realtime.DEFAULT_PROMPT_SOURCE_DIR
    manifest = json.loads(prompt_realtime.PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    config = {
        key: (source_dir / manifest[key]["file"]).read_text(encoding="utf-8").strip()
        for key in prompt_realtime.PROMPT_FIELDS
    }
    task_cards = json.loads((source_dir / manifest["taskCardManifest"]).read_text(encoding="utf-8"))
    task_card_id = manifest["defaultTaskCardId"]
    config["taskCardId"] = task_card_id
    config["taskCardPrompt"] = (
        source_dir / "task-cards" / task_cards[task_card_id]["file"]
    ).read_text(encoding="utf-8").strip()
    examples = task_cards[task_card_id].get("examples", {})
    conversation_examples = {}
    for role, example in examples.items():
        conversation_examples[role] = (
            source_dir / "task-cards" / example["file"]
        ).read_text(encoding="utf-8").strip()
    if conversation_examples:
        config["conversationExamplePrompts"] = conversation_examples
    return config


def _expected_prompt(config, role: str) -> str:
    role_key = f"{role}Prompt"
    prompt = f"{config['basePrompt']}\n\n{config[role_key]}\n\n{config['taskCardPrompt']}"
    example = config.get("conversationExamplePrompts", {}).get(role)
    return f"{prompt}\n\n{example}" if example else prompt


def _write_prompt_source_with_examples(source_dir):
    task_cards_dir = source_dir / "task-cards"
    examples_dir = task_cards_dir / "examples"
    examples_dir.mkdir(parents=True)
    (source_dir / "manifest.json").write_text(
        """
        {
          "basePrompt": {"file": "base.md", "marker": "# BASE PROMPT:"},
          "dominantPrompt": {
            "file": "roles/dominant.md",
            "marker": "# INTERLOCUTOR ROLE PROMPT: Dominant"
          },
          "collaborativePrompt": {
            "file": "roles/collaborative.md",
            "marker": "# INTERLOCUTOR ROLE PROMPT: Collaborative"
          },
          "taskCardManifest": "task-cards/manifest.json",
          "defaultTaskCardId": "example"
        }
        """,
        encoding="utf-8",
    )
    (source_dir / "roles").mkdir()
    (source_dir / "base.md").write_text("# BASE PROMPT: Example\nbase", encoding="utf-8")
    (source_dir / "roles" / "dominant.md").write_text(
        "# INTERLOCUTOR ROLE PROMPT: Dominant\ndominant",
        encoding="utf-8",
    )
    (source_dir / "roles" / "collaborative.md").write_text(
        "# INTERLOCUTOR ROLE PROMPT: Collaborative\ncollaborative",
        encoding="utf-8",
    )
    (task_cards_dir / "manifest.json").write_text(
        """
        {
          "example": {
            "file": "task_card.md",
            "marker": "# TASK CARD:",
            "examples": {
              "dominant": {
                "file": "examples/example.dominant.md",
                "marker": "# CONVERSATION EXAMPLE: Dominant"
              },
              "collaborative": {
                "file": "examples/example.collaborative.md",
                "marker": "# CONVERSATION EXAMPLE: Collaborative"
              }
            }
          }
        }
        """,
        encoding="utf-8",
    )
    (task_cards_dir / "task_card.md").write_text("# TASK CARD: Example\ntask", encoding="utf-8")
    (examples_dir / "example.dominant.md").write_text(
        "# CONVERSATION EXAMPLE: Dominant\ndominant example",
        encoding="utf-8",
    )
    (examples_dir / "example.collaborative.md").write_text(
        "# CONVERSATION EXAMPLE: Collaborative\ncollaborative example",
        encoding="utf-8",
    )


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


def test_realtime_prompt_uses_runtime_task_card_id(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "prompt_config.json"
    config_path.write_text(
        """
        {
          "realtime": {
            "basePrompt": "Runtime base prompt.",
            "dominantPrompt": "Runtime dominant role.",
            "collaborativePrompt": "Runtime collaborative role.",
            "taskCardId": "school_event_invitation"
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", config_path)
    prompt = build_prompt(role="dominant")

    assert prompt.startswith(
        "Runtime base prompt.\n\nRuntime dominant role.\n\n"
        "# TASK CARD: Plan a School Event and Invite Friends"
    )
    assert "Runtime task card." not in prompt


def test_realtime_prompt_call_task_card_id_overrides_runtime_selection(
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
            "taskCardId": "school_event_invitation"
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", config_path)
    prompt = build_prompt(role="dominant", task_card_id="morning_exercise_challenge")

    assert "# TASK CARD: Our Class Morning Exercise Challenge" in prompt
    assert "# TASK CARD: Plan a School Event and Invite Friends" not in prompt


def test_realtime_opening_comes_from_selected_task_card(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    assert get_opening_sentence("morning_exercise_challenge") == (
        "Hi, I'm Daisy. Today, let's choose one morning exercise for our class. "
        "What is your name?"
    )
    assert get_opening_sentence("school_event_invitation") == (
        "Hi, I'm Daisy. Today, let's choose one school event and make an invitation. "
        "What is your name?"
    )


def test_realtime_opening_falls_back_when_task_card_has_no_opening(
    tmp_path, monkeypatch
) -> None:
    source_dir = tmp_path / "realtime"
    source_dir.mkdir()
    _write_prompt_source_with_examples(source_dir)
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_SOURCE_DIR", source_dir)
    monkeypatch.setattr(prompt_realtime, "PROMPT_SOURCE_MANIFEST_PATH", source_dir / "manifest.json")
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    assert get_opening_sentence("example") == prompt_realtime.DEFAULT_OPENING_SENTENCE


def test_realtime_prompt_appends_role_specific_conversation_example(tmp_path, monkeypatch) -> None:
    source_dir = tmp_path / "realtime"
    source_dir.mkdir()
    _write_prompt_source_with_examples(source_dir)
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_SOURCE_DIR", source_dir)
    monkeypatch.setattr(prompt_realtime, "PROMPT_SOURCE_MANIFEST_PATH", source_dir / "manifest.json")
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    dominant_prompt = build_prompt(role="dominant")
    collaborative_prompt = build_prompt(role="collaborative")

    assert dominant_prompt.endswith(
        "# TASK CARD: Example\ntask\n\n# CONVERSATION EXAMPLE: Dominant\ndominant example"
    )
    assert "# CONVERSATION EXAMPLE: Collaborative" not in dominant_prompt
    assert collaborative_prompt.endswith(
        "# TASK CARD: Example\ntask\n\n"
        "# CONVERSATION EXAMPLE: Collaborative\ncollaborative example"
    )
    assert "# CONVERSATION EXAMPLE: Dominant" not in collaborative_prompt


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
