from prompt_realtime import build_prompt, normalize_stance


def test_realtime_prompt_includes_dominant_stance_rules() -> None:
    prompt = build_prompt("Junbo", stance="dominant")

    assert "Lead the task flow actively." in prompt
    assert "Make clear suggestions." in prompt
    assert "Let the user lead the task flow." not in prompt
    assert "Your friend's name is Junbo." in prompt


def test_realtime_prompt_includes_passive_stance_rules() -> None:
    prompt = build_prompt("Junbo", stance="passive")

    assert "Let the user lead the task flow." in prompt
    assert "Accept the user's suggestions when they fit your schedule." in prompt
    assert "Lead the task flow actively." not in prompt
    assert "Your friend's name is Junbo." in prompt


def test_realtime_prompt_defaults_to_dominant_stance() -> None:
    assert normalize_stance("unknown") == "dominant"
    assert "Lead the task flow actively." in build_prompt(stance="unknown")
