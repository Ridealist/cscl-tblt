import asyncio
import json
import logging
from copy import deepcopy

from logger import (
    ConversationLogger,
    SupabaseConversationConfig,
    SupabaseConversationWriter,
)


class RecordingSupabaseWriter:
    def __init__(self) -> None:
        self.started = 0
        self.metadata_syncs: list[dict] = []
        self.event_batches: list[list[dict]] = []
        self.closed_count = 0
        self.closed_metadata: dict | None = None

    def start(self) -> None:
        self.started += 1

    def sync_session_metadata(self, metadata: dict) -> None:
        self.metadata_syncs.append(deepcopy(metadata))

    def write_events(self, entries: list[dict]) -> None:
        self.event_batches.append(deepcopy(entries))

    def end_session(self, metadata: dict) -> None:
        self.closed_count += 1
        self.closed_metadata = deepcopy(metadata)


class FailingSupabaseWriter:
    def start(self) -> None:
        raise RuntimeError("session insert failed")

    def sync_session_metadata(self, metadata: dict) -> None:
        raise RuntimeError("metadata sync failed")

    def write_events(self, entries: list[dict]) -> None:
        raise RuntimeError("event insert failed")

    def end_session(self, metadata: dict) -> None:
        raise RuntimeError("session close failed")


class FakeResponse:
    def __init__(self, body: str = "") -> None:
        self._body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return self._body


def read_log_file(logs_dir):
    files = list(logs_dir.glob("*.json"))
    assert len(files) == 1
    return json.loads(files[0].read_text(encoding="utf-8"))


def test_conversation_logger_keeps_file_logging_without_supabase(tmp_path) -> None:
    logger = ConversationLogger(
        "livekit-room-sid",
        "9-1",
        metadata={"agent_mode": "pipeline"},
        logs_dir=tmp_path,
        supabase_writer=None,
    )

    logger.log(
        "user",
        "Hello.",
        participant_identity="student-1",
        participant_name="Minji",
    )

    payload = read_log_file(tmp_path)
    assert payload["session_id"] == "livekit-room-sid"
    assert payload["room"] == "9-1"
    assert payload["metadata"] == {"agent_mode": "pipeline"}
    assert payload["entries"] == [
        {
            "timestamp": payload["entries"][0]["timestamp"],
            "sequence": 1,
            "role": "user",
            "text": "Hello.",
            "participant_identity": "student-1",
            "participant_name": "Minji",
        }
    ]


def test_conversation_logger_dual_writes_pending_events_to_mock_writer(tmp_path) -> None:
    writer = RecordingSupabaseWriter()
    logger = ConversationLogger(
        "livekit-room-sid",
        "realtime-minji",
        metadata={
            "agent_mode": "realtime",
            "agent_role": "collaborative",
            "feedback_condition_id": "explicit_correction",
            "task_card_id": "school_event_invitation",
            "prompt_version_id": "8c747fcb-8db6-42dd-a2dd-9639d413c441",
        },
        logs_dir=tmp_path,
        supabase_writer=writer,
    )

    logger.log("user", "I am free.", participant_identity="student-1", participant_name="Minji")
    logger.log("agent", "Great. What time?")
    logger.update_metadata(
        {
            "egress_id": "egress-123",
            "recording_path": "recordings/realtime-minji--20260612_010101.mp3",
        }
    )
    logger.close()

    assert writer.started == 1
    assert [batch[0]["sequence"] for batch in writer.event_batches] == [1, 2]
    assert [batch[0]["role"] for batch in writer.event_batches] == ["user", "agent"]
    assert writer.metadata_syncs[-1]["egress_id"] == "egress-123"
    assert writer.closed_metadata is not None
    assert writer.closed_metadata["recording_path"].startswith("recordings/")

    payload = read_log_file(tmp_path)
    assert len(payload["entries"]) == 2
    assert payload["metadata"]["egress_id"] == "egress-123"


def test_conversation_logger_batches_events_when_loop_is_running(tmp_path) -> None:
    async def run() -> RecordingSupabaseWriter:
        writer = RecordingSupabaseWriter()
        logger = ConversationLogger(
            "livekit-room-sid",
            "9-1",
            metadata={"agent_mode": "pipeline"},
            logs_dir=tmp_path,
            supabase_writer=writer,
        )

        logger.log("user", "First.", participant_identity="student-1")
        logger.log("agent", "Second.")
        await asyncio.sleep(1.1)
        return writer

    writer = asyncio.run(run())

    assert len(writer.event_batches) == 1
    assert [entry["sequence"] for entry in writer.event_batches[0]] == [1, 2]
    assert [entry["role"] for entry in writer.event_batches[0]] == ["user", "agent"]


def test_conversation_logger_close_is_idempotent(tmp_path) -> None:
    writer = RecordingSupabaseWriter()
    logger = ConversationLogger(
        "livekit-room-sid",
        "9-1",
        metadata={"agent_mode": "pipeline"},
        logs_dir=tmp_path,
        supabase_writer=writer,
    )

    logger.log("agent", "Hi.")
    logger.close()
    logger.close()

    assert logger.closed is True
    assert writer.closed_count == 1


def test_supabase_failures_do_not_stop_file_logging(tmp_path, caplog) -> None:
    caplog.set_level(logging.ERROR)
    logger = ConversationLogger(
        "livekit-room-sid",
        "9-1",
        metadata={"agent_mode": "pipeline"},
        logs_dir=tmp_path,
        supabase_writer=FailingSupabaseWriter(),
    )

    logger.log("agent", "Hi, are you free this weekend?")
    logger.close()

    payload = read_log_file(tmp_path)
    assert payload["entries"][0]["text"] == "Hi, are you free this weekend?"
    assert "continuing local file logging" in caplog.text


def test_supabase_writer_posts_session_and_events_payloads() -> None:
    calls: list[dict] = []

    def opener(request, timeout):
        body = request.data.decode("utf-8") if request.data else ""
        payload = json.loads(body) if body else None
        calls.append(
            {
                "method": request.get_method(),
                "url": request.full_url,
                "body": payload,
                "timeout": timeout,
            }
        )
        if "class_sessions" in request.full_url and request.get_method() == "POST":
            return FakeResponse(f'[{{"id":"{payload["id"]}"}}]')
        return FakeResponse()

    writer = SupabaseConversationWriter(
        "livekit-room-sid",
        "realtime-minji",
        {
            "agent_mode": "realtime",
            "agent_role": "passive",
            "feedback_condition_id": "no_corrective",
            "task_card_id": "morning_exercise_challenge",
            "prompt_version_id": "8c747fcb-8db6-42dd-a2dd-9639d413c441",
        },
        SupabaseConversationConfig(url="http://supabase.test", key="secret", timeout=7),
        opener=opener,
        class_session_id="11111111-1111-4111-8111-111111111111",
    )

    writer.start()
    writer.write_events(
        [
            {
                "timestamp": "2026-06-12T01:02:03.000000Z",
                "sequence": 1,
                "role": "user",
                "text": "I want go to the park.",
                "participant_identity": "student-1",
                "participant_name": "Minji",
            }
        ]
    )

    assert calls[0]["method"] == "POST"
    assert "class_sessions?on_conflict=id&select=id" in calls[0]["url"]
    assert calls[0]["body"]["id"] == "11111111-1111-4111-8111-111111111111"
    assert calls[0]["body"]["livekit_session_id"] == "livekit-room-sid"
    assert calls[0]["body"]["agent_mode"] == "realtime"
    assert calls[0]["body"]["agent_role"] == "collaborative"
    assert calls[0]["body"]["prompt_version_id"] == "8c747fcb-8db6-42dd-a2dd-9639d413c441"

    assert calls[1]["method"] == "POST"
    assert calls[1]["url"].endswith("/rest/v1/conversation_events")
    assert calls[1]["body"][0]["session_id"] == "11111111-1111-4111-8111-111111111111"
    assert calls[1]["body"][0]["sequence"] == 1
    assert calls[1]["body"][0]["participant_name"] == "Minji"
    assert calls[1]["timeout"] == 7


def test_supabase_writer_creates_distinct_class_sessions_for_reused_livekit_sid() -> None:
    calls: list[dict] = []

    def opener(request, timeout):
        body = request.data.decode("utf-8") if request.data else ""
        payload = json.loads(body) if body else None
        calls.append(
            {
                "method": request.get_method(),
                "url": request.full_url,
                "body": payload,
            }
        )
        if "class_sessions" in request.full_url and request.get_method() == "POST":
            return FakeResponse(f'[{{"id":"{payload["id"]}"}}]')
        return FakeResponse()

    first = SupabaseConversationWriter(
        "reused-livekit-room-sid",
        "1-1",
        {"agent_mode": "pipeline"},
        SupabaseConversationConfig(url="http://supabase.test", key="secret"),
        opener=opener,
        class_session_id="11111111-1111-4111-8111-111111111111",
    )
    second = SupabaseConversationWriter(
        "reused-livekit-room-sid",
        "1-1",
        {"agent_mode": "pipeline"},
        SupabaseConversationConfig(url="http://supabase.test", key="secret"),
        opener=opener,
        class_session_id="22222222-2222-4222-8222-222222222222",
    )

    first.start()
    second.start()

    assert [call["body"]["livekit_session_id"] for call in calls] == [
        "reused-livekit-room-sid",
        "reused-livekit-room-sid",
    ]
    assert [call["body"]["id"] for call in calls] == [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
    ]
    assert all("class_sessions?on_conflict=id&select=id" in call["url"] for call in calls)


def test_supabase_writer_patches_recording_metadata_and_session_end() -> None:
    calls: list[dict] = []

    def opener(request, timeout):
        body = request.data.decode("utf-8") if request.data else ""
        payload = json.loads(body) if body else None
        calls.append(
            {
                "method": request.get_method(),
                "url": request.full_url,
                "body": payload,
                "prefer": request.headers.get("Prefer"),
            }
        )
        if "class_sessions" in request.full_url and request.get_method() == "POST":
            return FakeResponse(f'[{{"id":"{payload["id"]}"}}]')
        return FakeResponse()

    writer = SupabaseConversationWriter(
        "livekit-room-sid",
        "realtime-minji",
        {"agent_mode": "pipeline"},
        SupabaseConversationConfig(url="http://supabase.test", key="secret"),
        opener=opener,
        class_session_id="22222222-2222-4222-8222-222222222222",
    )

    metadata = {
        "agent_mode": "pipeline",
        "egress_id": "egress-123",
        "recording_path": "recordings/9-1--20260612_010101.mp3",
    }
    writer.sync_session_metadata(metadata)
    writer.end_session(metadata)

    assert calls[0]["method"] == "POST"
    assert calls[1]["method"] == "PATCH"
    assert "class_sessions?id=eq.22222222-2222-4222-8222-222222222222" in calls[1]["url"]
    assert calls[1]["body"]["egress_id"] == "egress-123"
    assert calls[1]["body"]["recording_path"].startswith("recordings/")
    assert calls[1]["prefer"] == "return=minimal"

    assert calls[2]["method"] == "PATCH"
    assert calls[2]["body"]["ended_at"].endswith("Z")
    assert calls[2]["body"]["metadata"]["egress_id"] == "egress-123"
