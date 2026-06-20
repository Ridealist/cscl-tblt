import importlib.util
from pathlib import Path
from textwrap import dedent


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_realtime_prompts.py"
SOURCE_PATH = REPO_ROOT / "prompts" / "realtime"


def _load_check_module():
    spec = importlib.util.spec_from_file_location("check_realtime_prompts", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _write_feedback_source(source: Path) -> None:
    feedbacks = source / "feedbacks"
    feedbacks.mkdir()
    (feedbacks / "manifest.json").write_text(
        """
        {
          "no_corrective": {
            "file": "no_corrective.md",
            "marker": "# FEEDBACK CONDITION PROMPT: No Feedback"
          }
        }
        """,
        encoding="utf-8",
    )
    (feedbacks / "no_corrective.md").write_text(
        "# FEEDBACK CONDITION PROMPT: No Feedback\nno feedback",
        encoding="utf-8",
    )


def test_prompt_sources_are_read_as_realtime_prompt_config() -> None:
    check_prompts = _load_check_module()
    config = check_prompts.read_prompt_source(SOURCE_PATH)
    manifest = check_prompts.read_manifest(SOURCE_PATH)
    task_cards = check_prompts.read_task_card_manifest(SOURCE_PATH, manifest)
    task_card_id = manifest["defaultTaskCardId"]
    condition_combinations = check_prompts.read_condition_combination_manifest(
        SOURCE_PATH, manifest
    )

    assert set(config["realtime"]) == {
        "basePrompt",
        "dominantPrompt",
        "collaborativePrompt",
        "feedbackConditionId",
        "feedbackPrompt",
        "conditionCombinationPrompts",
        "taskCardId",
        "taskCardPrompt",
    }
    for key in check_prompts.PROMPT_FIELDS:
        assert config["realtime"][key] == (SOURCE_PATH / manifest[key]["file"]).read_text(
            encoding="utf-8"
        ).strip()
    assert config["realtime"]["taskCardId"] == task_card_id
    assert config["realtime"]["taskCardPrompt"] == (
        task_cards[task_card_id]["base_path"] / task_cards[task_card_id]["file"]
    ).read_text(encoding="utf-8").strip()
    assert set(config["realtime"]["conditionCombinationPrompts"]) == set(
        check_prompts.CONDITION_COMBINATION_PROMPT_KEYS
    )
    for key, entry in condition_combinations.items():
        assert config["realtime"]["conditionCombinationPrompts"][key] == (
            entry["base_path"] / entry["file"]
        ).read_text(encoding="utf-8").strip()


def test_prompt_source_parser_splits_pasted_document_sections() -> None:
    check_prompts = _load_check_module()
    source = dedent("""
    Any copied document title or notes above the prompt are ignored.

    # BASE PROMPT: Example
    base body

    # INTERLOCUTOR ROLE PROMPT: Dominant AI Interlocutor
    dominant body

    # INTERLOCUTOR ROLE PROMPT: Collaborative AI Interlocutor
    collaborative body

    # TASK CARD: Example
    task card body
    """)

    manifest = {
        "basePrompt": {"file": "base.md", "marker": "# BASE PROMPT:"},
        "dominantPrompt": {
            "file": "dominant.md",
            "marker": "# INTERLOCUTOR ROLE PROMPT: Dominant",
        },
        "collaborativePrompt": {
            "file": "collaborative.md",
            "marker": "# INTERLOCUTOR ROLE PROMPT: Collaborative",
        },
        "taskCardPrompt": {"file": "task_card.md", "marker": "# TASK CARD:"},
    }

    assert check_prompts.parse_prompt_source(source, manifest) == {
        "realtime": {
            "basePrompt": "# BASE PROMPT: Example\nbase body",
            "dominantPrompt": (
                "# INTERLOCUTOR ROLE PROMPT: Dominant AI Interlocutor\n"
                "dominant body"
            ),
            "collaborativePrompt": (
                "# INTERLOCUTOR ROLE PROMPT: Collaborative AI Interlocutor\n"
                "collaborative body"
            ),
            "taskCardPrompt": "# TASK CARD: Example\ntask card body",
        }
    }


def test_prompt_folder_rejects_wrong_file_heading(tmp_path) -> None:
    check_prompts = _load_check_module()
    source = tmp_path / "realtime"
    source.mkdir()
    (source / "manifest.json").write_text(
        """
        {
          "basePrompt": {"file": "base.md", "marker": "# BASE PROMPT:"},
          "dominantPrompt": {
            "file": "dominant.md",
            "marker": "# INTERLOCUTOR ROLE PROMPT: Dominant"
          },
          "collaborativePrompt": {
            "file": "collaborative.md",
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
    task_cards = source / "task-cards"
    task_cards.mkdir()
    (task_cards / "manifest.json").write_text(
        """
        {
          "example": {"file": "task_card.md", "marker": "# TASK CARD:"}
        }
        """,
        encoding="utf-8",
    )
    (source / "base.md").write_text("# BASE PROMPT: Example\nbase", encoding="utf-8")
    (source / "dominant.md").write_text("# BASE PROMPT: Wrong\ndominant", encoding="utf-8")
    (source / "collaborative.md").write_text(
        "# INTERLOCUTOR ROLE PROMPT: Collaborative AI Interlocutor\ncollab",
        encoding="utf-8",
    )
    (task_cards / "task_card.md").write_text("# TASK CARD: Example\ntask", encoding="utf-8")

    try:
        check_prompts.read_prompt_folder(source)
    except ValueError as exc:
        assert "dominant.md" in str(exc)
        assert "# INTERLOCUTOR ROLE PROMPT: Dominant" in str(exc)
    else:
        raise AssertionError("expected wrong heading to fail")


def test_prompt_folder_rejects_missing_file(tmp_path) -> None:
    check_prompts = _load_check_module()
    source = tmp_path / "realtime"
    source.mkdir()
    (source / "manifest.json").write_text(
        """
        {
          "basePrompt": {"file": "base.md", "marker": "# BASE PROMPT:"},
          "dominantPrompt": {
            "file": "dominant.md",
            "marker": "# INTERLOCUTOR ROLE PROMPT: Dominant"
          },
          "collaborativePrompt": {
            "file": "collaborative.md",
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
    (source / "task-cards").mkdir()
    (source / "task-cards" / "manifest.json").write_text(
        """
        {
          "example": {"file": "task_card.md", "marker": "# TASK CARD:"}
        }
        """,
        encoding="utf-8",
    )

    try:
        check_prompts.read_prompt_folder(source)
    except ValueError as exc:
        assert "base.md" in str(exc)
    else:
        raise AssertionError("expected missing prompt file to fail")


def test_prompt_folder_rejects_incomplete_manifest(tmp_path) -> None:
    check_prompts = _load_check_module()
    source = tmp_path / "realtime"
    source.mkdir()
    (source / "manifest.json").write_text(
        """
        {
          "basePrompt": {"file": "base.md", "marker": "# BASE PROMPT:"}
        }
        """,
        encoding="utf-8",
    )

    try:
        check_prompts.read_prompt_folder(source)
    except ValueError as exc:
        assert "dominantPrompt" in str(exc)
    else:
        raise AssertionError("expected incomplete manifest to fail")
