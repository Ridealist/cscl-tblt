import prompt_evaluation
from prompt_evaluation import build_prompt_from_source, get_opening_sentence_from_source


def test_evaluation_prompt_loads_default_source() -> None:
    source = prompt_evaluation.load_prompt_source()

    assert source.source == "evaluation"
    assert source.evaluation_id == "pretest_6_10"
    assert source.evaluation_prompt_id == "pretest_6_10"
    assert source.evaluation_prompt_version == "2026-06-10"
    assert source.evaluation_character == "Kate"
    assert source.prompt.startswith("# PRE-TEST INTERACTION PROMPT: Kate")
    assert (
        get_opening_sentence_from_source(source)
        == "Hi, I’m Kate. I just moved to Korea. Nice to meet you!"
    )


def test_evaluation_prompt_adds_session_info() -> None:
    source = prompt_evaluation.load_prompt_source("pretest_6_10")
    prompt = build_prompt_from_source(source, participant_name="Minji")

    assert prompt.startswith(source.prompt)
    assert "# SESSION INFO" in prompt
    assert "Your friend's name is Minji." in prompt


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
                "# PRE-TEST INTERACTION PROMPT: Kate\n"
                "# Opening\n"
                "Version hello.\n"
                "# Body\n"
                "Version evaluation prompt."
            ),
            "evaluation_prompt_version": "2026-06-10",
            "evaluation_character": "Kate",
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
