import prompt_evaluation
from prompt_evaluation import (
    build_prompt_from_source,
    build_prompt_stack_from_source,
    get_opening_sentence_from_source,
)


def test_evaluation_prompt_loads_default_source() -> None:
    source = prompt_evaluation.load_prompt_source()

    assert source.source == "evaluation"
    assert source.evaluation_id == "pretest_6_10"
    assert source.evaluation_prompt_id == "pretest_6_10"
    assert source.evaluation_prompt_version == "2026-06-10"
    assert source.evaluation_character == "Jack"
    assert source.prompt.startswith("# PRE-TEST INTERACTION PROMPT: Jack")
    assert (
        get_opening_sentence_from_source(source)
        == "Hi, I’m Jack. I just moved to Korea. Nice to meet you!"
    )


def test_evaluation_prompt_adds_session_info() -> None:
    source = prompt_evaluation.load_prompt_source("pretest_6_10")
    prompt = build_prompt_from_source(source, participant_name="Minji")

    assert prompt.startswith(source.prompt)
    assert "# SESSION INFO" in prompt
    assert "Your friend's name is Minji." in prompt


def test_evaluation_prompt_stack_records_prompt_and_final_prompt() -> None:
    source = prompt_evaluation.load_prompt_source("pretest_6_10")
    stack = build_prompt_stack_from_source(source, participant_name="Minji")

    assert stack["schema_version"] == 1
    assert stack["mode"] == "realtime_evaluation"
    assert stack["evaluation_id"] == "pretest_6_10"
    assert stack["evaluation_prompt_id"] == "pretest_6_10"
    assert stack["participant_name"] == "Minji"
    assert stack["stack_order"] == ["evaluation_prompt:pretest_6_10"]
    assert stack["chunks"] == [
        {
            "id": "evaluation_prompt:pretest_6_10",
            "title": "Evaluation Prompt: pretest_6_10",
            "content": source.prompt,
        }
    ]
    assert stack["final_prompt"].startswith(source.prompt)
    assert "Your friend's name is Minji." in stack["final_prompt"]


def test_evaluation_prompt_ignores_legacy_runtime_override_without_version_id() -> None:
    source = prompt_evaluation.load_prompt_source("pretest_6_10")

    assert source.source == "evaluation"
    assert source.evaluation_prompt_id == "pretest_6_10"
    assert source.prompt_version_id is None
    assert source.saved_at is None


def test_evaluation_prompt_uses_supabase_prompt_version_snapshot(monkeypatch) -> None:
    monkeypatch.setattr(
        prompt_evaluation,
        "_fetch_prompt_version_row",
        lambda prompt_version_id: {
            "id": prompt_version_id,
            "purpose": "evaluation",
            "evaluation_id": "pretest_6_10",
            "evaluation_prompt": (
                "# PRE-TEST INTERACTION PROMPT: Jack\n"
                "# Opening\n"
                "Version hello.\n"
                "# Body\n"
                "Version evaluation prompt."
            ),
            "evaluation_prompt_version": "2026-06-10",
            "evaluation_character": "Jack",
            "evaluation_opening_sentence": "Stored hello.",
            "source": "custom",
            "created_at": "2026-06-13T01:00:00.000Z",
        },
    )

    source = prompt_evaluation.load_prompt_source("pretest_6_10", "eval-version")

    assert source.source == "custom"
    assert source.evaluation_id == "pretest_6_10"
    assert source.evaluation_prompt_id == "eval-version"
    assert source.prompt_version_id == "eval-version"
    assert source.saved_at == "2026-06-13T01:00:00.000Z"
    assert source.prompt.endswith("Version evaluation prompt.")
    assert get_opening_sentence_from_source(source) == "Version hello."
