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


def test_evaluation_prompt_uses_runtime_override(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "prompt_config.json"
    config_path.write_text(
        """
        {
          "evaluation": {
            "evaluationPrompts": {
              "pretest_6_10": {
                "prompt": "# PRE-TEST INTERACTION PROMPT: Kate\\n# Opening\\nCustom hello.\\n# Body\\nCustom evaluation prompt.",
                "promptId": "custom-eval",
                "savedAt": "2026-06-13T00:00:00.000Z"
              }
            }
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_evaluation, "PROMPT_CONFIG_PATH", config_path)

    source = prompt_evaluation.load_prompt_source("pretest_6_10")

    assert source.source == "custom"
    assert source.evaluation_id == "pretest_6_10"
    assert source.evaluation_prompt_id == "custom-eval"
    assert source.prompt_version_id == "custom-eval"
    assert source.saved_at == "2026-06-13T00:00:00.000Z"
    assert source.prompt.endswith("Custom evaluation prompt.")
    assert get_opening_sentence_from_source(source) == "Custom hello."


def test_evaluation_prompt_uses_prompt_version_snapshot(tmp_path, monkeypatch) -> None:
    versions_dir = tmp_path / "prompt_versions"
    evaluation_versions_dir = versions_dir / "evaluation"
    evaluation_versions_dir.mkdir(parents=True)
    (evaluation_versions_dir / "eval-version.json").write_text(
        """
        {
          "schemaVersion": 1,
          "purpose": "evaluation",
          "id": "eval-version",
          "label": "Evaluation version",
          "createdAt": "2026-06-13T01:00:00.000Z",
          "hash": "hash",
          "config": {
            "evaluationId": "pretest_6_10",
            "prompt": "# PRE-TEST INTERACTION PROMPT: Kate\\n# Opening\\nVersion hello.\\n# Body\\nVersion evaluation prompt."
          }
        }
        """,
        encoding="utf-8",
    )
    config_path = tmp_path / "prompt_config.json"
    config_path.write_text(
        """
        {
          "evaluation": {
            "evaluationPrompts": {
              "pretest_6_10": {
                "prompt": "# PRE-TEST INTERACTION PROMPT: Kate\\nRuntime override.",
                "promptId": "runtime-eval"
              }
            }
          }
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_evaluation, "PROMPT_VERSIONS_DIR", versions_dir)
    monkeypatch.setattr(prompt_evaluation, "PROMPT_CONFIG_PATH", config_path)

    source = prompt_evaluation.load_prompt_source("pretest_6_10", "eval-version")

    assert source.source == "custom"
    assert source.evaluation_id == "pretest_6_10"
    assert source.evaluation_prompt_id == "eval-version"
    assert source.prompt_version_id == "eval-version"
    assert source.saved_at == "2026-06-13T01:00:00.000Z"
    assert source.prompt.endswith("Version evaluation prompt.")
    assert get_opening_sentence_from_source(source) == "Version hello."
