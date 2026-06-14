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
    assert get_opening_sentence_from_source(source) == "Hi, I’m Kate. I’m new here. Nice to meet you!"


def test_evaluation_prompt_adds_session_info() -> None:
    source = prompt_evaluation.load_prompt_source("pretest_6_10")
    prompt = build_prompt_from_source(source, participant_name="Minji")

    assert prompt.startswith(source.prompt)
    assert "# SESSION INFO" in prompt
    assert "Your friend's name is Minji." in prompt
