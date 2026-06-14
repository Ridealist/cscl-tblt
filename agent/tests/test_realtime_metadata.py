import json
import sys
import types


class _FakeAgent:
    def __init__(self, *args, **kwargs):
        pass


class _FakeAgentServer:
    def rtc_session(self, *args, **kwargs):
        def decorator(fn):
            return fn

        return decorator


class _FakeTurnDetection:
    def __init__(self, *args, **kwargs):
        pass


def _install_livekit_mocks() -> None:
    livekit = types.ModuleType("livekit")
    api = types.ModuleType("livekit.api")
    api.LiveKitAPI = lambda *args, **kwargs: types.SimpleNamespace(
        egress=types.SimpleNamespace(),
        aclose=lambda: None,
    )
    api.S3Upload = lambda *args, **kwargs: types.SimpleNamespace()
    api.RoomCompositeEgressRequest = lambda *args, **kwargs: types.SimpleNamespace()
    api.EncodedFileOutput = lambda *args, **kwargs: types.SimpleNamespace()
    api.EncodedFileType = types.SimpleNamespace(MP3="MP3")
    api.StopEgressRequest = lambda *args, **kwargs: types.SimpleNamespace()
    livekit.api = api

    agents = types.ModuleType("livekit.agents")
    agents.Agent = _FakeAgent
    agents.AgentServer = _FakeAgentServer
    agents.AgentSession = object
    agents.JobContext = object
    agents.JobProcess = object
    agents.cli = types.SimpleNamespace(run_app=lambda server: None)
    agents.room_io = types.SimpleNamespace()
    agents.llm = types.SimpleNamespace(ChatContext=object, ChatMessage=object)
    agents.inference = types.SimpleNamespace()

    plugins = types.ModuleType("livekit.plugins")
    plugins.openai = types.SimpleNamespace()

    openai_module = types.ModuleType("openai")
    openai_types = types.ModuleType("openai.types")
    openai_beta = types.ModuleType("openai.types.beta")
    openai_realtime = types.ModuleType("openai.types.beta.realtime")
    openai_session = types.ModuleType("openai.types.beta.realtime.session")
    openai_session.TurnDetection = _FakeTurnDetection

    sys.modules.setdefault("livekit", livekit)
    sys.modules.setdefault("livekit.api", api)
    sys.modules.setdefault("livekit.agents", agents)
    sys.modules.setdefault("livekit.plugins", plugins)
    sys.modules.setdefault("openai", openai_module)
    sys.modules.setdefault("openai.types", openai_types)
    sys.modules.setdefault("openai.types.beta", openai_beta)
    sys.modules.setdefault("openai.types.beta.realtime", openai_realtime)
    sys.modules.setdefault("openai.types.beta.realtime.session", openai_session)


_install_livekit_mocks()

from main import (  # noqa: E402
    _metadata_activity_context,
    _normalize_activity_context,
    _realtime_tts_extra_kwargs_for_session_purpose,
    _realtime_tts_voice_for_session_purpose,
)


def test_metadata_activity_context_maps_evaluation_fields() -> None:
    metadata = json.dumps(
        {
            "activityType": "free_conversation",
            "agentMode": "realtime",
            "evaluationCharacter": "Kate",
            "evaluationId": "pretest_6_10",
            "evaluationPromptId": "pretest_6_10",
            "evaluationPromptVersion": "2026-06-10",
            "sessionPurpose": "evaluation",
        }
    )

    assert _metadata_activity_context(metadata) == {
        "activity_type": "free_conversation",
        "evaluation_character": "Kate",
        "evaluation_id": "pretest_6_10",
        "evaluation_prompt_id": "pretest_6_10",
        "evaluation_prompt_version": "2026-06-10",
        "session_purpose": "evaluation",
    }


def test_normalize_activity_context_maps_execution_to_practice() -> None:
    assert _normalize_activity_context({"session_purpose": "execution"}) == {
        "activity_type": "task_solution",
        "session_purpose": "practice",
    }


def test_normalize_activity_context_prioritizes_free_conversation() -> None:
    assert _normalize_activity_context({"activity_type": "free_conversation"}) == {
        "activity_type": "free_conversation",
        "session_purpose": "evaluation",
    }


def test_realtime_tts_voice_changes_by_session_purpose() -> None:
    assert (
        _realtime_tts_voice_for_session_purpose("evaluation")
        == "b7d50908-b17c-442d-ad8d-810c63997ed9"
    )
    assert (
        _realtime_tts_voice_for_session_purpose("practice")
        == "b7d50908-b17c-442d-ad8d-810c63997ed9"
    )
    assert (
        _realtime_tts_voice_for_session_purpose(None)
        == "b7d50908-b17c-442d-ad8d-810c63997ed9"
    )


def test_realtime_tts_extra_kwargs_change_by_session_purpose() -> None:
    assert _realtime_tts_extra_kwargs_for_session_purpose("evaluation") == {
        "speed": 0.8,
        "volume": 1.0,
    }
    assert _realtime_tts_extra_kwargs_for_session_purpose("practice") == {
        "speed": 0.8,
        "volume": 1.1,
    }
    assert _realtime_tts_extra_kwargs_for_session_purpose(None) == {
        "speed": 0.8,
        "volume": 1.1,
    }
