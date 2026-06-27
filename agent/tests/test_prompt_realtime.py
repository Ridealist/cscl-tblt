import json

import prompt_realtime
from prompt_realtime import (
    build_prompt,
    get_opening_sentence,
    normalize_feedback_condition,
    normalize_role,
)


def _read_default_prompt_sources():
    source_dir = prompt_realtime.DEFAULT_PROMPT_SOURCE_DIR
    manifest = json.loads(prompt_realtime.PROMPT_SOURCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    config = {
        key: (source_dir / manifest[key]["file"]).read_text(encoding="utf-8").strip()
        for key in prompt_realtime.PROMPT_FIELDS
    }
    feedbacks = json.loads(
        (source_dir / manifest["feedbackConditionManifest"]).read_text(encoding="utf-8")
    )
    feedback_id = manifest["defaultFeedbackConditionId"]
    config["feedbackConditionId"] = feedback_id
    config["feedbackPrompt"] = (
        source_dir / "feedbacks" / feedbacks[feedback_id]["file"]
    ).read_text(encoding="utf-8").strip()
    condition_combinations = json.loads(
        (source_dir / manifest["conditionCombinationManifest"]).read_text(encoding="utf-8")
    )
    config["conditionCombinationPrompts"] = {
        key: (source_dir / "condition-combinations" / entry["file"])
        .read_text(encoding="utf-8")
        .strip()
        for key, entry in condition_combinations.items()
    }
    task_cards = json.loads(
        (source_dir / manifest["taskCardManifest"]).read_text(encoding="utf-8")
    )
    task_card_id = manifest["defaultTaskCardId"]
    config["taskCardId"] = task_card_id
    config["taskCardPrompt"] = (
        source_dir / "task-cards" / task_cards[task_card_id]["file"]
    ).read_text(encoding="utf-8").strip()
    return config


def _expected_prompt(config, role: str) -> str:
    role_key = f"{role}Prompt"
    feedback_suffix = (
        "explicit_correction"
        if config["feedbackConditionId"] == "explicit_correction"
        else "no_feedback"
    )
    condition_prompt = config.get("conditionCombinationPrompts", {}).get(
        f"{role}_{feedback_suffix}",
        "",
    )
    chunks = [config["basePrompt"], config[role_key]]
    if condition_prompt:
        chunks.append(condition_prompt)
    chunks.append(config["taskCardPrompt"])
    return "\n\n".join(chunks)


def _prompt_version_row(
    *,
    version_id: str = "00000000-0000-4000-8000-000000000035",
    task_card_id: str = "morning_exercise_challenge",
    feedback_condition_id: str = "explicit_correction",
    task_card_prompt: str = "# TASK CARD: Runtime\n# Opening\nHi from runtime card.",
    condition_combination_prompts: dict[str, str] | None = None,
):
    return {
        "id": version_id,
        "base_prompt": "Runtime base prompt.",
        "dominant_prompt": "Runtime dominant role.",
        "collaborative_prompt": "Runtime collaborative role.",
        "feedback_condition_id": feedback_condition_id,
        "feedback_prompt": "Runtime feedback condition.",
        "condition_combination_prompts": condition_combination_prompts or {},
        "task_card_id": task_card_id,
        "task_card_prompt": task_card_prompt,
        "source": "custom",
        "is_active": True,
        "created_at": "2026-06-12T00:00:00.000Z",
    }


def _write_prompt_source(source_dir):
    task_cards_dir = source_dir / "task-cards"
    task_cards_dir.mkdir(parents=True)
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
          "conditionCombinationManifest": "condition-combinations/manifest.json",
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
            "marker": "# FEEDBACK CONDITION PROMPT: No Feedback"
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
        "# FEEDBACK CONDITION PROMPT: No Feedback\nno feedback",
        encoding="utf-8",
    )
    (source_dir / "feedbacks" / "explicit_correction.md").write_text(
        "# FEEDBACK CONDITION PROMPT: Explicit Correction\nexplicit feedback",
        encoding="utf-8",
    )
    (source_dir / "condition-combinations").mkdir()
    (source_dir / "condition-combinations" / "manifest.json").write_text(
        """
        {
          "dominant_no_feedback": {
            "file": "dominant_no_feedback.md",
            "marker": "# CONDITION COMBINATION PROMPT: Dominant + No Feedback"
          },
          "dominant_explicit_correction": {
            "file": "dominant_explicit_correction.md",
            "marker": "# CONDITION COMBINATION PROMPT: Dominant + Explicit Correction"
          },
          "collaborative_no_feedback": {
            "file": "collaborative_no_feedback.md",
            "marker": "# CONDITION COMBINATION PROMPT: Collaborative + No Feedback"
          },
          "collaborative_explicit_correction": {
            "file": "collaborative_explicit_correction.md",
            "marker": "# CONDITION COMBINATION PROMPT: Collaborative + Explicit Correction"
          }
        }
        """,
        encoding="utf-8",
    )
    for filename, marker, body in (
        (
            "dominant_no_feedback.md",
            "# CONDITION COMBINATION PROMPT: Dominant + No Feedback",
            "dominant no feedback combo",
        ),
        (
            "dominant_explicit_correction.md",
            "# CONDITION COMBINATION PROMPT: Dominant + Explicit Correction",
            "dominant explicit combo",
        ),
        (
            "collaborative_no_feedback.md",
            "# CONDITION COMBINATION PROMPT: Collaborative + No Feedback",
            "collaborative no feedback combo",
        ),
        (
            "collaborative_explicit_correction.md",
            "# CONDITION COMBINATION PROMPT: Collaborative + Explicit Correction",
            "collaborative explicit combo",
        ),
    ):
        (source_dir / "condition-combinations" / filename).write_text(
            f"{marker}\n{body}",
            encoding="utf-8",
        )
    (task_cards_dir / "manifest.json").write_text(
        """
        {
          "example": {
            "file": "task_card.md",
            "marker": "# TASK CARD:"
          }
        }
        """,
        encoding="utf-8",
    )
    (task_cards_dir / "task_card.md").write_text("# TASK CARD: Example\ntask", encoding="utf-8")


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


def test_realtime_prompt_stack_records_chunks_and_final_prompt() -> None:
    source = prompt_realtime.load_prompt_source(feedback_condition_id="explicit_correction")
    stack = prompt_realtime.build_prompt_stack_from_source(source, "Junbo", role="dominant")

    assert stack["schema_version"] == 1
    assert stack["mode"] == "realtime_practice"
    assert stack["agent_role"] == "dominant"
    assert stack["feedback_condition_id"] == "explicit_correction"
    assert stack["condition_combination_key"] == "dominant_explicit_correction"
    assert stack["task_card_id"] == source.task_card_id
    assert stack["participant_name"] == "Junbo"
    assert stack["stack_order"] == [
        "base",
        "role:dominant",
        "condition_combination:dominant_explicit_correction",
        f"task_card:{source.task_card_id}",
    ]
    assert [chunk["id"] for chunk in stack["chunks"]] == stack["stack_order"]
    assert "# CONDITION COMBINATION PROMPT: Dominant + Explicit Correction" in stack["final_prompt"]
    assert "# FEEDBACK CONDITION PROMPT:" not in stack["final_prompt"]
    assert "Your friend's name is Junbo." in stack["final_prompt"]


def test_realtime_prompt_defaults_live_only_in_markdown_sources() -> None:
    assert not hasattr(prompt_realtime, "BASE_PROMPT")
    assert not hasattr(prompt_realtime, "ROLE_PROMPTS")
    assert not hasattr(prompt_realtime, "TASK_CARD_PROMPT")
    assert not hasattr(prompt_realtime, "PROMPT_CONFIG_PATH")
    assert not hasattr(prompt_realtime, "PROMPT_VERSIONS_DIR")


def test_realtime_default_prompt_source_records_default_task_card_id() -> None:
    source = prompt_realtime.load_prompt_source()

    assert source.source == "default"
    assert source.task_card_id == "special_activity_plan"
    assert source.task_card_prompt.startswith("# TASK CARD: Our Class Special Activity Plan")
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
        "conditionCombinationPrompts": row["condition_combination_prompts"],
        "taskCardId": row["task_card_id"],
        "taskCardPrompt": row["task_card_prompt"],
    }

    assert build_prompt(role="dominant", prompt_version_id=row["id"]) == _expected_prompt(
        config, "dominant"
    )
    assert build_prompt(role="collaborative", prompt_version_id=row["id"]) == _expected_prompt(
        config, "collaborative"
    )


def test_realtime_prompt_source_maps_supabase_prompt_version_metadata(monkeypatch) -> None:
    row = _prompt_version_row()
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    source = prompt_realtime.load_prompt_source(prompt_version_id=row["id"])

    assert source.source == "custom"
    assert source.prompt_version_id == row["id"]
    assert source.saved_at == "2026-06-12T00:00:00.000Z"
    assert source.task_card_id == "morning_exercise_challenge"
    assert source.feedback_condition == "explicit_correction"


def test_realtime_prompt_version_uses_task_card_snapshot_without_examples(
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

    assert prompt == (
        "Runtime base prompt.\n\nRuntime dominant role.\n\n"
        "# TASK CARD: Runtime\nRuntime task card."
    )
    assert "CONVERSATION EXAMPLE" not in prompt


def test_realtime_prompt_version_removes_obsolete_conversation_example_stack_line(
    monkeypatch,
) -> None:
    row = _prompt_version_row(
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
    )
    row["base_prompt"] = (
        "# BASE PROMPT: Runtime\n"
        "# Prompt Stack\n"
        "Use this prompt with:\n"
        "1. ONE Interlocutor Role Prompt\n"
        "2. ONE Condition Combination Prompt\n"
        "3. ONE Task Card\n"
        "4. ONE Conversation Example, when available"
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    prompt = build_prompt(role="dominant", prompt_version_id=row["id"])

    assert "4. ONE Conversation Example, when available" not in prompt
    assert "3. ONE Task Card" in prompt


def test_realtime_prompt_version_inserts_selected_condition_combination_before_task_card(
    monkeypatch,
) -> None:
    row = _prompt_version_row(
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
        condition_combination_prompts={
            "dominant_no_feedback": "Dominant no feedback condition.",
            "dominant_explicit_correction": "Dominant explicit condition.",
            "collaborative_no_feedback": "Collaborative no feedback condition.",
            "collaborative_explicit_correction": "Collaborative explicit condition.",
        },
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    prompt = build_prompt(role="collaborative", prompt_version_id=row["id"])

    assert prompt == (
        "Runtime base prompt.\n\nRuntime collaborative role.\n\n"
        "Collaborative explicit condition.\n\n# TASK CARD: Runtime\nRuntime task card."
    )
    assert "Dominant no feedback condition." not in prompt
    assert "Dominant explicit condition." not in prompt
    assert "Collaborative no feedback condition." not in prompt


def test_realtime_prompt_version_skips_empty_condition_combination_prompt(
    monkeypatch,
) -> None:
    row = _prompt_version_row(
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
        condition_combination_prompts={
            "collaborative_explicit_correction": "",
        },
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    prompt = build_prompt(role="collaborative", prompt_version_id=row["id"])

    assert prompt == (
        "Runtime base prompt.\n\nRuntime collaborative role.\n\n"
        "# TASK CARD: Runtime\nRuntime task card."
    )


def test_realtime_prompt_version_runtime_feedback_condition_overrides_snapshot(
    tmp_path, monkeypatch
) -> None:
    source_dir = tmp_path / "realtime"
    source_dir.mkdir()
    _write_prompt_source(source_dir)
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_SOURCE_DIR", source_dir)
    monkeypatch.setattr(
        prompt_realtime,
        "PROMPT_SOURCE_MANIFEST_PATH",
        source_dir / "manifest.json",
    )
    row = _prompt_version_row(
        feedback_condition_id="explicit_correction",
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
        condition_combination_prompts={
            "dominant_no_feedback": "Dominant no feedback condition.",
            "dominant_explicit_correction": "Dominant explicit condition.",
        },
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    source = prompt_realtime.load_prompt_source(
        feedback_condition_id="no_corrective",
        prompt_version_id=row["id"],
    )
    prompt = build_prompt(
        role="dominant",
        feedback_condition_id="no_corrective",
        prompt_version_id=row["id"],
    )

    assert source.feedback_condition == "no_corrective"
    assert "Dominant no feedback condition." in prompt
    assert "Dominant explicit condition." not in prompt
    assert "Runtime feedback condition." not in prompt
    assert "explicit feedback" not in prompt


def test_realtime_prompt_version_reads_legacy_no_corrective_condition_combination_key(
    monkeypatch,
) -> None:
    row = _prompt_version_row(
        feedback_condition_id="no_corrective",
        task_card_prompt="# TASK CARD: Runtime\nRuntime task card.",
        condition_combination_prompts={
            "dominant_no_corrective": "Legacy dominant no feedback condition.",
        },
    )
    monkeypatch.setattr(
        prompt_realtime,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: row,
    )

    prompt = build_prompt(role="dominant", prompt_version_id=row["id"])

    assert prompt == (
        "Runtime base prompt.\n\nRuntime dominant role.\n\n"
        "Legacy dominant no feedback condition.\n\n# TASK CARD: Runtime\nRuntime task card."
    )


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


def test_realtime_prompt_call_feedback_condition_overrides_default_selection(
    tmp_path, monkeypatch
) -> None:
    prompt = build_prompt(
        role="dominant",
        task_card_id="morning_exercise_challenge",
        feedback_condition_id="explicit_correction",
    )

    assert "# CONDITION COMBINATION PROMPT: Dominant + Explicit Correction" in prompt
    assert "# CONDITION COMBINATION PROMPT: Dominant + No Feedback" not in prompt


def test_realtime_prompt_call_task_card_id_overrides_default_selection(
    tmp_path, monkeypatch
) -> None:
    prompt = build_prompt(role="dominant", task_card_id="school_event_invitation")

    assert "# TASK CARD: Plan a School Event and Invite Friends" in prompt
    assert "# TASK CARD: Our Class Morning Exercise Challenge" not in prompt


def test_realtime_prompt_call_healthy_habit_task_card_id_overrides_default_selection(
    tmp_path, monkeypatch
) -> None:
    prompt = build_prompt(role="dominant", task_card_id="healthy_habit_stamp_card")

    assert "# TASK CARD: Our Class Healthy Habit Stamp Card" in prompt
    assert "# TASK CARD: Our Class Morning Exercise Challenge" not in prompt


def test_realtime_prompt_default_uses_special_activity_plan_task_card(
    tmp_path, monkeypatch
) -> None:
    prompt = build_prompt(role="dominant")

    assert "# TASK CARD: Our Class Special Activity Plan" in prompt
    assert "# TASK CARD: Our Class Healthy Habit Stamp Card" not in prompt


def test_realtime_opening_comes_from_selected_task_card(tmp_path, monkeypatch) -> None:
    assert get_opening_sentence("morning_exercise_challenge") == (
        "Hi, I'm Kate. Let's choose one morning exercise activity for our Class."
    )
    assert get_opening_sentence("school_event_invitation") == (
        "Hi, I'm Kate. Today, let's choose one school event and make an invitation."
    )
    assert get_opening_sentence("healthy_habit_stamp_card") == (
        "Hi, I'm Kate. Let's choose three healthy habits for our Class's stamp card."
    )


def test_realtime_opening_comes_from_special_activity_plan_without_placeholder(
    tmp_path, monkeypatch
) -> None:
    opening = get_opening_sentence("special_activity_plan")

    assert opening == (
        "Hi, I'm Kate. Let's choose three special activity plan for our class. "
        'Let\'s start from step 1. When you are ready, say "Okay."'
    )
    assert "(곧 입력 예정)" not in opening


def test_realtime_opening_falls_back_when_task_card_has_no_opening(
    tmp_path, monkeypatch
) -> None:
    source_dir = tmp_path / "realtime"
    source_dir.mkdir()
    _write_prompt_source(source_dir)
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_SOURCE_DIR", source_dir)
    monkeypatch.setattr(prompt_realtime, "PROMPT_SOURCE_MANIFEST_PATH", source_dir / "manifest.json")

    assert get_opening_sentence("example") == prompt_realtime.DEFAULT_OPENING_SENTENCE


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
        "# TASK CARD: Runtime\nRuntime task card."
    )


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
