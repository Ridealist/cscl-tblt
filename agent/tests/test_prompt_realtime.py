import json
from pathlib import Path

import prompt_realtime
from prompt_realtime import build_prompt, get_opening_sentence, normalize_feedback_condition, normalize_role


def _read_default_prompt_sources():
    source_dir = prompt_realtime.DEFAULT_PROMPT_SOURCE_DIR
    manifest = json.loads(prompt_realtime.PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    config = {
        key: (source_dir / manifest[key]["file"]).read_text(encoding="utf-8").strip()
        for key in prompt_realtime.PROMPT_FIELDS
    }
    feedbacks = json.loads((source_dir / manifest["feedbackConditionManifest"]).read_text(encoding="utf-8"))
    feedback_id = manifest["defaultFeedbackConditionId"]
    config["feedbackConditionId"] = feedback_id
    config["feedbackPrompt"] = (
        source_dir / "feedbacks" / feedbacks[feedback_id]["file"]
    ).read_text(encoding="utf-8").strip()
    task_cards = json.loads((source_dir / manifest["taskCardManifest"]).read_text(encoding="utf-8"))
    task_card_id = manifest["defaultTaskCardId"]
    config["taskCardId"] = task_card_id
    config["taskCardPrompt"] = (
        source_dir / "task-cards" / task_cards[task_card_id]["file"]
    ).read_text(encoding="utf-8").strip()
    examples = task_cards[task_card_id].get("examples", {})
    conversation_examples = {}
    for role, role_examples in examples.items():
        for feedback_condition_id, example in role_examples.items():
            conversation_examples[f"{role}.{feedback_condition_id}"] = (
                source_dir / "task-cards" / example["file"]
            ).read_text(encoding="utf-8").strip()
    if conversation_examples:
        config["conversationExamplePrompts"] = conversation_examples
    return config


def _expected_prompt(config, role: str) -> str:
    role_key = f"{role}Prompt"
    prompt = (
        f"{config['basePrompt']}\n\n{config[role_key]}\n\n"
        f"{config['feedbackPrompt']}\n\n{config['taskCardPrompt']}"
    )
    feedback_condition_id = normalize_feedback_condition(config.get("feedbackConditionId"))
    example = config.get("conversationExamplePrompts", {}).get(
        f"{role}.{feedback_condition_id}"
    ) or config.get("conversationExamplePrompts", {}).get(role)
    return f"{prompt}\n\n{example}" if example else prompt


def _prompt_version_row(
    *,
    version_id: str = "00000000-0000-4000-8000-000000000035",
    task_card_id: str = "morning_exercise_challenge",
    feedback_condition_id: str = "explicit_correction",
    task_card_prompt: str = "# TASK CARD: Runtime\n# Opening\nHi from runtime card.",
):
    return {
        "id": version_id,
        "base_prompt": "Runtime base prompt.",
        "dominant_prompt": "Runtime dominant role.",
        "collaborative_prompt": "Runtime collaborative role.",
        "feedback_condition_id": feedback_condition_id,
        "feedback_prompt": "Runtime feedback condition.",
        "task_card_id": task_card_id,
        "task_card_prompt": task_card_prompt,
        "source": "custom",
        "is_active": True,
        "created_at": "2026-06-12T00:00:00.000Z",
    }


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
          "feedbackConditionManifest": "feedbacks/manifest.json",
          "defaultFeedbackConditionId": "no_corrective",
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
    (source_dir / "feedbacks").mkdir()
    (source_dir / "feedbacks" / "manifest.json").write_text(
        """
        {
          "no_corrective": {
            "file": "no_corrective.md",
            "marker": "# FEEDBACK CONDITION PROMPT: No Corrective Feedback"
          },
          "explicit_correction": {
            "file": "explicit_correction.md",
            "marker": "# FEEDBACK CONDITION PROMPT: Explicit Correction"
          }
        }
        """,
        encoding="utf-8",
    )
    (source_dir / "feedbacks" / "no_corrective.md").write_text(
        "# FEEDBACK CONDITION PROMPT: No Corrective Feedback\nno feedback",
        encoding="utf-8",
    )
    (source_dir / "feedbacks" / "explicit_correction.md").write_text(
        "# FEEDBACK CONDITION PROMPT: Explicit Correction\nexplicit feedback",
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
                "no_corrective": {
                  "file": "examples/example.dominant.no_fb.md",
                  "marker": "# CONVERSATION EXAMPLE: Dominant + No Corrective Feedback"
                },
                "explicit_correction": {
                  "file": "examples/example.dominant.explicit_fb.md",
                  "marker": "# CONVERSATION EXAMPLE: Dominant + Explicit Correction"
                }
              },
              "collaborative": {
                "no_corrective": {
                  "file": "examples/example.collaborative.no_fb.md",
                  "marker": "# CONVERSATION EXAMPLE: Collaborative + No Corrective Feedback"
                },
                "explicit_correction": {
                  "file": "examples/example.collaborative.explicit_fb.md",
                  "marker": "# CONVERSATION EXAMPLE: Collaborative + Explicit Correction"
                }
              }
            }
          }
        }
        """,
        encoding="utf-8",
    )
    (task_cards_dir / "task_card.md").write_text("# TASK CARD: Example\ntask", encoding="utf-8")
    (examples_dir / "example.dominant.no_fb.md").write_text(
        "# CONVERSATION EXAMPLE: Dominant + No Corrective Feedback\ndominant no feedback example",
        encoding="utf-8",
    )
    (examples_dir / "example.dominant.explicit_fb.md").write_text(
        "# CONVERSATION EXAMPLE: Dominant + Explicit Correction\ndominant explicit feedback example",
        encoding="utf-8",
    )
    (examples_dir / "example.collaborative.no_fb.md").write_text(
        "# CONVERSATION EXAMPLE: Collaborative + No Corrective Feedback\ncollaborative no feedback example",
        encoding="utf-8",
    )
    (examples_dir / "example.collaborative.explicit_fb.md").write_text(
        "# CONVERSATION EXAMPLE: Collaborative + Explicit Correction\ncollaborative explicit feedback example",
        encoding="utf-8",
    )


def test_realtime_prompt_builds_dominant_from_markdown_sources(
    tmp_path, monkeypatch
) -> None:
    config = _read_default_prompt_sources()

    assert build_prompt(role="dominant") == _expected_prompt(config, "dominant")


def test_realtime_prompt_builds_collaborative_from_markdown_sources(
    tmp_path, monkeypatch
) -> None:
    config = _read_default_prompt_sources()

    assert build_prompt(role="collaborative") == _expected_prompt(config, "collaborative")


def test_realtime_prompt_defaults_to_dominant_role(tmp_path, monkeypatch) -> None:
    assert normalize_role("unknown") == "dominant"
    assert build_prompt(role="unknown") == build_prompt(role="dominant")
    assert normalize_feedback_condition("unknown") == "no_corrective"


def test_realtime_prompt_maps_legacy_passive_to_collaborative(tmp_path, monkeypatch) -> None:
    assert normalize_role("passive") == "collaborative"
    assert build_prompt(role="passive") == build_prompt(role="collaborative")


def test_realtime_prompt_adds_session_info_after_markdown_prompt(tmp_path, monkeypatch) -> None:
    config = _read_default_prompt_sources()
    prompt_without_name = _expected_prompt(config, "collaborative")
    prompt_with_name = build_prompt("Junbo", role="collaborative")

    assert prompt_with_name.startswith(f"{prompt_without_name}\n\n# SESSION INFO\n")
    assert "Junbo" in prompt_with_name


def test_realtime_prompt_defaults_live_only_in_markdown_sources() -> None:
    assert not hasattr(prompt_realtime, "BASE_PROMPT")
    assert not hasattr(prompt_realtime, "ROLE_PROMPTS")
    assert not hasattr(prompt_realtime, "TASK_CARD_PROMPT")


def test_realtime_default_prompt_source_records_default_task_card_id() -> None:
    source = prompt_realtime.load_prompt_source()

    assert source.source == "default"
    assert source.task_card_id == "morning_exercise_challenge"
    assert source.prompt_version_id is None


def test_realtime_prompt_uses_supabase_prompt_version(monkeypatch) -> None:
    row = _prompt_version_row(
        task_card_id="custom_runtime_card",
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )
    config = {
        "basePrompt": row["base_prompt"],
        "dominantPrompt": row["dominant_prompt"],
        "collaborativePrompt": row["collaborative_prompt"],
        "feedbackConditionId": row["feedback_condition_id"],
        "feedbackPrompt": row["feedback_prompt"],
        "taskCardId": row["task_card_id"],
        "taskCardPrompt": row["task_card_prompt"],
    }

    assert build_prompt(role="dominant", prompt_version_id=row["id"]) == _expected_prompt(
        config, "dominant"
    )
    assert build_prompt(role="collaborative", prompt_version_id=row["id"]) == _expected_prompt(
        config, "collaborative"
    )


def test_realtime_prompt_version_loads_role_and_feedback_specific_example(
    monkeypatch,
) -> None:
    row = _prompt_version_row(
        task_card_id="morning_exercise_challenge",
        feedback_condition_id="explicit_correction",
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )
    prompt = build_prompt(role="dominant", prompt_version_id=row["id"])

    assert prompt.startswith(
        "Runtime base prompt.\n\nRuntime dominant role.\n\n"
        "Runtime feedback condition.\n\n# TASK CARD: Runtime"
    )
    assert "# CONVERSATION EXAMPLE: Dominant + Explicit Correction" in prompt


def test_realtime_opening_comes_from_supabase_prompt_version(
    monkeypatch,
) -> None:
    row = _prompt_version_row(
        task_card_prompt="# TASK CARD: Runtime\n# Opening\nHi from runtime card.",
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    assert get_opening_sentence(prompt_version_id=row["id"]) == "Hi from runtime card."


def test_realtime_prompt_call_feedback_condition_overrides_runtime_selection(
    tmp_path, monkeypatch
) -> None:
    prompt = build_prompt(
        role="dominant",
        task_card_id="morning_exercise_challenge",
        feedback_condition_id="no_corrective",
    )

    assert "# FEEDBACK CONDITION PROMPT: No Corrective Feedback" in prompt
    assert "# FEEDBACK CONDITION PROMPT: Explicit Correction" not in prompt
    assert "# CONVERSATION EXAMPLE: Dominant + No Corrective Feedback" in prompt


def test_realtime_prompt_call_task_card_id_overrides_runtime_selection(
    tmp_path, monkeypatch
) -> None:
    prompt = build_prompt(role="dominant", task_card_id="morning_exercise_challenge")

    assert "# TASK CARD: Our Class Morning Exercise Challenge" in prompt
    assert "# TASK CARD: Plan a School Event and Invite Friends" not in prompt


def test_realtime_opening_comes_from_selected_task_card(tmp_path, monkeypatch) -> None:
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

    assert get_opening_sentence("example") == prompt_realtime.DEFAULT_OPENING_SENTENCE


def test_realtime_prompt_appends_role_specific_conversation_example(tmp_path, monkeypatch) -> None:
    source_dir = tmp_path / "realtime"
    source_dir.mkdir()
    _write_prompt_source_with_examples(source_dir)
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_SOURCE_DIR", source_dir)
    monkeypatch.setattr(prompt_realtime, "PROMPT_SOURCE_MANIFEST_PATH", source_dir / "manifest.json")

    dominant_prompt = build_prompt(role="dominant")
    collaborative_prompt = build_prompt(role="collaborative")

    assert dominant_prompt.endswith(
        "# TASK CARD: Example\ntask\n\n"
        "# CONVERSATION EXAMPLE: Dominant + No Corrective Feedback\n"
        "dominant no feedback example"
    )
    assert "# CONVERSATION EXAMPLE: Collaborative" not in dominant_prompt
    assert collaborative_prompt.endswith(
        "# TASK CARD: Example\ntask\n\n"
        "# CONVERSATION EXAMPLE: Collaborative + No Corrective Feedback\n"
        "collaborative no feedback example"
    )
    assert "# CONVERSATION EXAMPLE: Dominant" not in collaborative_prompt


def test_realtime_prompt_uses_collaborative_prompt_from_supabase_version(
    monkeypatch,
) -> None:
    row = _prompt_version_row(
        task_card_id="custom_runtime_card",
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    assert build_prompt(role="passive", prompt_version_id=row["id"]) == (
        "Runtime base prompt.\n\nRuntime collaborative role.\n\n"
        "Runtime feedback condition.\n\n# TASK CARD: Runtime\nRuntime task card."
    )


def test_realtime_prompt_ignores_legacy_prompt_config_without_prompt_version(
) -> None:
    config_path = Path(prompt_realtime.__file__).parent.parent / "prompt_config.json"
    original = config_path.read_text(encoding="utf-8") if config_path.exists() else None
    try:
        config_path.write_text(
            """
            {
              "realtime": {
                "basePrompt": "Runtime base prompt.",
                "dominantPrompt": "Runtime dominant role.",
                "passivePrompt": "Runtime passive role.",
                "feedbackPrompt": "Runtime feedback condition.",
                "taskCardPrompt": "Runtime task card."
              }
            }
            """,
            encoding="utf-8",
        )
        config = _read_default_prompt_sources()

        assert build_prompt(role="collaborative") == _expected_prompt(config, "collaborative")
    finally:
        if original is None:
            config_path.unlink(missing_ok=True)
        else:
            config_path.write_text(original, encoding="utf-8")


def test_realtime_prompt_version_fetch_failure_does_not_fallback(
    monkeypatch,
) -> None:
    def raise_fetch_error(prompt_version_id):
        raise prompt_realtime.PromptVersionFetchError("database unavailable")

    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        raise_fetch_error,
    )

    try:
        build_prompt(role="dominant", prompt_version_id="custom-version")
    except prompt_realtime.PromptVersionFetchError as exc:
        assert "database unavailable" in str(exc)
    else:
        raise AssertionError("expected custom prompt version fetch failure to fail")


def test_realtime_prompt_version_missing_env_does_not_fallback(monkeypatch) -> None:
    for key in (
        "SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
    ):
        monkeypatch.delenv(key, raising=False)

    try:
        build_prompt(role="dominant", prompt_version_id="custom-version")
    except prompt_realtime.PromptVersionFetchError as exc:
        assert "not configured" in str(exc)
    else:
        raise AssertionError("expected missing Supabase prompt env to fail")


def test_realtime_prompt_missing_default_source_fails(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_SOURCE_DIR", tmp_path / "missing")

    try:
        build_prompt(role="dominant")
    except RuntimeError as exc:
        assert "Default realtime prompt source is missing or invalid" in str(exc)
    else:
        raise AssertionError("expected missing default prompt source to fail")
