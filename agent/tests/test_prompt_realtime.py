import prompt_realtime
from prompt_realtime import build_prompt, normalize_stance


def test_realtime_prompt_includes_dominant_stance_rules(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")
    prompt = build_prompt("Junbo", stance="dominant")

    assert "You and the student must choose one eco-campaign" in prompt
    assert "Guide the task actively from start to finish." in prompt
    assert "I think lights-off is best." in prompt
    assert "Let the student lead the choice as much as possible." not in prompt
    assert "Your friend's name is Junbo." in prompt


def test_realtime_prompt_includes_passive_stance_rules(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")
    prompt = build_prompt("Junbo", stance="passive")

    assert "You and the student must choose one eco-campaign" in prompt
    assert "Let the student lead the choice as much as possible." in prompt
    assert "Accept the student's idea when it is safe and possible." in prompt
    assert "Guide the task actively from start to finish." not in prompt
    assert "Your friend's name is Junbo." in prompt


def test_realtime_prompt_defaults_to_dominant_stance(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    assert normalize_stance("unknown") == "dominant"
    assert "Guide the task actively from start to finish." in build_prompt(stance="unknown")


def test_realtime_prompt_uses_tracked_default_config(tmp_path, monkeypatch) -> None:
    default_path = tmp_path / "prompt_config.default.json"
    default_path.write_text(
        """
        {
          "realtime": {
            "basePrompt": "Tracked default base prompt.",
            "dominantPrompt": "Tracked default dominant rule.",
            "passivePrompt": "Tracked default passive rule."
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_CONFIG_PATH", default_path)
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    prompt = build_prompt("Junbo", stance="passive")

    assert "Tracked default base prompt." in prompt
    assert "Tracked default passive rule." in prompt
    assert "Tracked default dominant rule." not in prompt
    assert "Your friend's name is Junbo." in prompt


def test_realtime_prompt_uses_runtime_config(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "prompt_config.json"
    config_path.write_text(
        """
        {
          "realtime": {
            "basePrompt": "Runtime base prompt.",
            "dominantPrompt": "Runtime dominant rule.",
            "passivePrompt": "Runtime passive rule."
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", config_path)

    dominant = build_prompt("Junbo", stance="dominant")
    passive = build_prompt("Junbo", stance="passive")

    assert "Runtime base prompt." in dominant
    assert "Runtime dominant rule." in dominant
    assert "Runtime passive rule." not in dominant
    assert "Runtime passive rule." in passive
    assert "Your friend's name is Junbo." in passive
