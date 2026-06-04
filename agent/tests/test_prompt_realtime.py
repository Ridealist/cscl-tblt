import prompt_realtime
from prompt_realtime import build_prompt, normalize_role


def test_realtime_prompt_includes_dominant_role_and_task_card(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")
    prompt = build_prompt("Junbo", role="dominant")

    assert "# BASE PROMPT: Daisy, English Task Friend" in prompt
    assert "# INTERLOCUTOR ROLE PROMPT: Dominant AI Interlocutor" in prompt
    assert "# TASK CARD: Plan a School Event and Invite Friends" in prompt
    assert "Task facts come only from the Task Card." in prompt
    assert "Daisy controls the task sequence." in prompt
    assert "Daisy and the student must choose one event." in prompt
    assert "Can you come to our ___?" in prompt
    assert "School Festival" in prompt
    assert "Sports Day" in prompt
    assert "Music Festival" in prompt
    assert "You and the student must choose one eco-campaign" not in prompt
    assert "Our slogan is" not in prompt
    assert "# INTERLOCUTOR ROLE PROMPT: Collaborative AI Interlocutor" not in prompt
    assert "Your friend's name is Junbo." in prompt


def test_realtime_prompt_includes_collaborative_role_rules(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")
    prompt = build_prompt("Junbo", role="collaborative")

    assert "# INTERLOCUTOR ROLE PROMPT: Collaborative AI Interlocutor" in prompt
    assert "Daisy and the student share control." in prompt
    assert "Student ideas shape the next steps." in prompt
    assert 'use "we," "our," and "together"' in prompt
    assert "# TASK CARD: Plan a School Event and Invite Friends" in prompt
    assert "# INTERLOCUTOR ROLE PROMPT: Dominant AI Interlocutor" not in prompt
    assert "Daisy controls the task sequence." not in prompt
    assert "Your friend's name is Junbo." in prompt


def test_realtime_prompt_defaults_to_dominant_role(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    assert normalize_role("unknown") == "dominant"
    assert "# INTERLOCUTOR ROLE PROMPT: Dominant AI Interlocutor" in build_prompt(role="unknown")


def test_realtime_prompt_maps_legacy_passive_to_collaborative(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    assert normalize_role("passive") == "collaborative"
    assert "# INTERLOCUTOR ROLE PROMPT: Collaborative AI Interlocutor" in build_prompt(
        role="passive"
    )


def test_realtime_prompt_uses_tracked_default_config(tmp_path, monkeypatch) -> None:
    default_path = tmp_path / "prompt_config.default.json"
    default_path.write_text(
        """
        {
          "realtime": {
            "basePrompt": "Tracked default base prompt.",
            "dominantPrompt": "Tracked default dominant role.",
            "collaborativePrompt": "Tracked default collaborative role.",
            "taskCardPrompt": "Tracked default task card."
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_realtime, "DEFAULT_PROMPT_CONFIG_PATH", default_path)
    monkeypatch.setattr(prompt_realtime, "PROMPT_CONFIG_PATH", tmp_path / "missing.json")

    prompt = build_prompt("Junbo", role="collaborative")

    assert "Tracked default base prompt." in prompt
    assert "Tracked default collaborative role." in prompt
    assert "Tracked default dominant role." not in prompt
    assert "Tracked default task card." in prompt
    assert "Your friend's name is Junbo." in prompt


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

    dominant = build_prompt("Junbo", role="dominant")
    collaborative = build_prompt("Junbo", role="collaborative")

    assert "Runtime base prompt." in dominant
    assert "Runtime dominant role." in dominant
    assert "Runtime collaborative role." not in dominant
    assert "Runtime collaborative role." in collaborative
    assert "Runtime task card." in collaborative
    assert "Your friend's name is Junbo." in collaborative
