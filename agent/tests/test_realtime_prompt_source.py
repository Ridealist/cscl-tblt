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


def test_prompt_sources_are_read_as_realtime_prompt_config() -> None:
    check_prompts = _load_check_module()
    config = check_prompts.read_prompt_source(SOURCE_PATH)
    manifest = check_prompts.read_manifest(SOURCE_PATH)
    task_cards = check_prompts.read_task_card_manifest(SOURCE_PATH, manifest)
    task_card_id = manifest["defaultTaskCardId"]

    assert set(config["realtime"]) == {
        "basePrompt",
        "dominantPrompt",
        "collaborativePrompt",
        "taskCardId",
        "taskCardPrompt",
        "conversationExamplePrompts",
    }
    for key in check_prompts.PROMPT_FIELDS:
        assert config["realtime"][key] == (SOURCE_PATH / manifest[key]["file"]).read_text(
            encoding="utf-8"
        ).strip()
    assert config["realtime"]["taskCardId"] == task_card_id
    assert config["realtime"]["taskCardPrompt"] == (
        task_cards[task_card_id]["base_path"] / task_cards[task_card_id]["file"]
    ).read_text(encoding="utf-8").strip()
    assert set(config["realtime"]["conversationExamplePrompts"]) == {
        "dominant",
        "collaborative",
    }


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


def test_prompt_folder_reads_optional_conversation_examples(tmp_path) -> None:
    check_prompts = _load_check_module()
    source = tmp_path / "realtime"
    source.mkdir()
    (source / "roles").mkdir()
    (source / "manifest.json").write_text(
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
    task_cards = source / "task-cards"
    examples = task_cards / "examples"
    examples.mkdir(parents=True)
    (task_cards / "manifest.json").write_text(
        """
        {
          "example": {
            "file": "task_card.md",
            "marker": "# TASK CARD:",
            "examples": {
              "dominant": {
                "file": "examples/example.dominant.md",
                "marker": "# CONVERSATION EXAMPLE: Dominant"
              }
            }
          }
        }
        """,
        encoding="utf-8",
    )
    (source / "base.md").write_text("# BASE PROMPT: Example\nbase", encoding="utf-8")
    (source / "roles" / "dominant.md").write_text(
        "# INTERLOCUTOR ROLE PROMPT: Dominant\ndominant",
        encoding="utf-8",
    )
    (source / "roles" / "collaborative.md").write_text(
        "# INTERLOCUTOR ROLE PROMPT: Collaborative\ncollab",
        encoding="utf-8",
    )
    (task_cards / "task_card.md").write_text("# TASK CARD: Example\ntask", encoding="utf-8")
    (examples / "example.dominant.md").write_text(
        "# CONVERSATION EXAMPLE: Dominant\ndominant example",
        encoding="utf-8",
    )

    config = check_prompts.read_prompt_folder(source)

    assert config["realtime"]["conversationExamplePrompts"] == {
        "dominant": "# CONVERSATION EXAMPLE: Dominant\ndominant example"
    }


def test_prompt_folder_rejects_wrong_conversation_example_heading(tmp_path) -> None:
    check_prompts = _load_check_module()
    source = tmp_path / "realtime"
    source.mkdir()
    (source / "roles").mkdir()
    (source / "manifest.json").write_text(
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
    task_cards = source / "task-cards"
    examples = task_cards / "examples"
    examples.mkdir(parents=True)
    (task_cards / "manifest.json").write_text(
        """
        {
          "example": {
            "file": "task_card.md",
            "marker": "# TASK CARD:",
            "examples": {
              "dominant": {
                "file": "examples/example.dominant.md",
                "marker": "# CONVERSATION EXAMPLE: Dominant"
              }
            }
          }
        }
        """,
        encoding="utf-8",
    )
    (source / "base.md").write_text("# BASE PROMPT: Example\nbase", encoding="utf-8")
    (source / "roles" / "dominant.md").write_text(
        "# INTERLOCUTOR ROLE PROMPT: Dominant\ndominant",
        encoding="utf-8",
    )
    (source / "roles" / "collaborative.md").write_text(
        "# INTERLOCUTOR ROLE PROMPT: Collaborative\ncollab",
        encoding="utf-8",
    )
    (task_cards / "task_card.md").write_text("# TASK CARD: Example\ntask", encoding="utf-8")
    (examples / "example.dominant.md").write_text(
        "# WRONG HEADING\ndominant example",
        encoding="utf-8",
    )

    try:
        check_prompts.read_prompt_folder(source)
    except ValueError as exc:
        assert "example.dominant.md" in str(exc)
        assert "# CONVERSATION EXAMPLE: Dominant" in str(exc)
    else:
        raise AssertionError("expected wrong conversation example heading to fail")


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
