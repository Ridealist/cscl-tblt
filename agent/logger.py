import asyncio
import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

LOGS_DIR = Path(__file__).parent.parent / "logs"
SESSION_ACTIVITY_COLUMNS = (
    "session_purpose",
    "activity_type",
    "evaluation_id",
    "evaluation_prompt_id",
    "evaluation_prompt_version",
)

log = logging.getLogger(__name__)


def _utc_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="microseconds") + "Z"


def _optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _optional_uuid(value: Any) -> str | None:
    text = _optional_text(value)
    if not text or text == "default":
        return None
    try:
        return str(UUID(text))
    except ValueError:
        return None


def _agent_mode(value: Any) -> str:
    return "realtime" if value == "realtime" else "pipeline"


def _agent_role(value: Any) -> str | None:
    if value == "passive":
        return "collaborative"
    return value if value in ("dominant", "collaborative") else None


def _session_purpose(value: Any) -> str:
    return "evaluation" if value == "evaluation" else "practice"


def _activity_type(value: Any) -> str | None:
    return value if value in ("free_conversation", "task_solution") else None


class FileConversationWriter:
    def __init__(self, path: Path) -> None:
        self.path = path

    def write(self, payload: dict) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)


@dataclass
class SupabaseConversationConfig:
    url: str
    key: str
    timeout: int = 5


class SupabaseRequestError(RuntimeError):
    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        super().__init__(
            f"Supabase request failed: {method} {path} {status} {body[:300]}"
        )
        self.method = method
        self.path = path
        self.status = status
        self.body = body


class SupabaseConversationWriter:
    def __init__(
        self,
        livekit_session_id: str,
        room_name: str,
        metadata: dict,
        config: SupabaseConversationConfig,
        opener=urlopen,
        class_session_id: str | None = None,
    ) -> None:
        self.livekit_session_id = livekit_session_id
        self.room_name = room_name
        self.metadata = metadata
        self.config = config
        self._opener = opener
        self._lock = threading.Lock()
        self._class_session_id = class_session_id or str(uuid4())
        self._session_ready = False
        self._last_metadata_json: str | None = None
        self._supports_session_activity_columns = True

    @classmethod
    def from_env(
        cls,
        livekit_session_id: str,
        room_name: str,
        metadata: dict,
    ) -> "SupabaseConversationWriter | None":
        url = (
            os.environ.get("SUPABASE_URL")
            or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
            or ""
        ).strip()
        key = (
            os.environ.get("SUPABASE_SECRET_KEY")
            or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or ""
        ).strip()
        if not url or not key:
            log.info(
                "Supabase conversation log dual-write disabled: missing Supabase URL or service key"
            )
            return None

        config = SupabaseConversationConfig(url=url.rstrip("/"), key=key)
        log.info("Supabase conversation log dual-write enabled: url=%s", config.url)
        return cls(livekit_session_id, room_name, metadata, config)

    def start(self) -> None:
        self._ensure_session()

    def sync_session_metadata(self, metadata: dict) -> None:
        metadata_json = json.dumps(metadata, sort_keys=True, ensure_ascii=False)
        if metadata_json == self._last_metadata_json and self._session_ready:
            return

        with self._lock:
            self._ensure_session_locked()
            if metadata_json == self._last_metadata_json:
                return
            self._write_class_session(
                "PATCH",
                f"class_sessions?id=eq.{quote(self._class_session_id or '', safe='')}",
                metadata,
                prefer="return=minimal",
            )
            self._last_metadata_json = metadata_json
            log.info(
                "Supabase conversation log session metadata synced: class_session_id=%s",
                self._class_session_id,
            )

    def write_events(self, entries: list[dict]) -> None:
        if not entries:
            return

        with self._lock:
            self._ensure_session_locked()
            payload = [
                {
                    "session_id": self._class_session_id,
                    "sequence": entry["sequence"],
                    "role": entry["role"],
                    "text": entry["text"],
                    "participant_identity": entry.get("participant_identity"),
                    "participant_name": entry.get("participant_name"),
                    "created_at": entry["timestamp"],
                }
                for entry in entries
            ]
            self._request(
                "POST",
                "conversation_events",
                payload,
                prefer="return=minimal",
            )
            log.info(
                "Supabase conversation events inserted: class_session_id=%s count=%s last_sequence=%s",
                self._class_session_id,
                len(entries),
                entries[-1]["sequence"],
            )

    def end_session(self, metadata: dict) -> None:
        with self._lock:
            self._ensure_session_locked()
            self._write_class_session(
                "PATCH",
                f"class_sessions?id=eq.{quote(self._class_session_id or '', safe='')}",
                metadata,
                extra_payload={"ended_at": _utc_timestamp()},
                prefer="return=minimal",
            )
            log.info(
                "Supabase conversation log session ended: class_session_id=%s",
                self._class_session_id,
            )

    def _ensure_session(self) -> None:
        with self._lock:
            self._ensure_session_locked()

    def _ensure_session_locked(self) -> None:
        if self._session_ready:
            return

        rows = self._write_class_session(
            "POST",
            "class_sessions?on_conflict=id&select=id",
            self.metadata,
            prefer="resolution=merge-duplicates,return=representation",
        )
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise RuntimeError("Supabase class_sessions insert returned no row.")
        class_session_id = rows[0].get("id")
        if not isinstance(class_session_id, str) or not class_session_id:
            raise RuntimeError("Supabase class_sessions insert returned no id.")
        self._class_session_id = class_session_id
        self._session_ready = True
        self._last_metadata_json = json.dumps(
            self.metadata,
            sort_keys=True,
            ensure_ascii=False,
        )
        log.info(
            "Supabase conversation log session ready: class_session_id=%s livekit_session_id=%s room=%s",
            self._class_session_id,
            self.livekit_session_id,
            self.room_name,
        )

    def _session_payload(self, metadata: dict, *, include_session_activity_columns: bool) -> dict:
        agent_mode = _agent_mode(metadata.get("agent_mode"))
        payload = {
            "id": self._class_session_id,
            "livekit_session_id": self.livekit_session_id,
            "room_name": self.room_name,
            "agent_mode": agent_mode,
            "agent_role": _agent_role(metadata.get("agent_role", metadata.get("agent_stance"))),
            "feedback_condition_id": _optional_text(metadata.get("feedback_condition_id")),
            "task_card_id": _optional_text(metadata.get("task_card_id")),
            "prompt_version_id": _optional_uuid(metadata.get("prompt_version_id")),
            "egress_id": _optional_text(metadata.get("egress_id")),
            "recording_path": _optional_text(metadata.get("recording_path")),
            "metadata": metadata,
        }
        if include_session_activity_columns:
            payload.update(
                {
                    "session_purpose": _session_purpose(metadata.get("session_purpose")),
                    "activity_type": _activity_type(metadata.get("activity_type")),
                    "evaluation_id": _optional_text(metadata.get("evaluation_id")),
                    "evaluation_prompt_id": _optional_text(metadata.get("evaluation_prompt_id")),
                    "evaluation_prompt_version": _optional_text(
                        metadata.get("evaluation_prompt_version")
                    ),
                }
            )
        return payload

    def _write_class_session(
        self,
        method: str,
        path: str,
        metadata: dict,
        *,
        extra_payload: dict | None = None,
        prefer: str | None = None,
    ) -> Any:
        payload = self._session_payload(
            metadata,
            include_session_activity_columns=self._supports_session_activity_columns,
        )
        if extra_payload:
            payload.update(extra_payload)
        try:
            return self._request(method, path, payload, prefer=prefer)
        except SupabaseRequestError as exc:
            if not self._is_missing_session_activity_column_error(exc):
                raise

            self._supports_session_activity_columns = False
            log.warning(
                "Supabase class_sessions schema is missing evaluation/session columns; "
                "retrying without dedicated columns. Apply the latest migration to enable "
                "Supabase column filtering for evaluation logs."
            )
            payload = self._session_payload(
                metadata,
                include_session_activity_columns=False,
            )
            if extra_payload:
                payload.update(extra_payload)
            return self._request(method, path, payload, prefer=prefer)

    def _is_missing_session_activity_column_error(self, error: SupabaseRequestError) -> bool:
        if error.status != 400 or "PGRST204" not in error.body:
            return False
        body = error.body.lower()
        return any(column in body for column in SESSION_ACTIVITY_COLUMNS)

    def _request(
        self,
        method: str,
        path: str,
        payload: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        data = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.config.key}",
            "apikey": self.config.key,
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer

        request = Request(
            f"{self.config.url}/rest/v1/{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with self._opener(request, timeout=self.config.timeout) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise SupabaseRequestError(method, path, exc.code, body) from exc
        except (TimeoutError, URLError, OSError) as exc:
            raise RuntimeError(f"Supabase request failed: {method} {path}") from exc

        if not body:
            return None
        return json.loads(body)


_DEFAULT_SUPABASE_WRITER = object()


class ConversationLogger:
    def __init__(
        self,
        session_id: str,
        room_name: str,
        metadata: dict | None = None,
        logs_dir: Path | None = None,
        supabase_writer: Any = _DEFAULT_SUPABASE_WRITER,
    ) -> None:
        logs_dir = logs_dir or LOGS_DIR
        logs_dir.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%y%m%d_%H%M%S_%f")
        self.path = logs_dir / f"{session_id}--{ts}.json"
        self.room = room_name
        self.session_id = session_id
        self.metadata = metadata or {}
        self.entries: list[dict] = []
        self._next_sequence = 1
        self._supabase_sent_count = 0
        self._closed = False
        self._flush_task: asyncio.Task | None = None
        self._file_writer = FileConversationWriter(self.path)
        self._supabase_writer = (
            SupabaseConversationWriter.from_env(session_id, room_name, self.metadata)
            if supabase_writer is _DEFAULT_SUPABASE_WRITER
            else supabase_writer
        )
        log.info("Conversation log: %s", self.path)
        self._start_supabase_writer()

    def log(
        self,
        role: str,
        text: str,
        participant_identity: str | None = None,
        participant_name: str | None = None,
    ) -> None:
        """
        role: 'user' | 'agent'
        participant_identity: LiveKit participant identity (user only)
        participant_name: LiveKit participant name (user only)
        """
        entry: dict = {
            "timestamp": _utc_timestamp(),
            "sequence": self._next_sequence,
            "role": role,
            "text": text,
        }
        self._next_sequence += 1
        if participant_identity:
            entry["participant_identity"] = participant_identity
        if participant_name:
            entry["participant_name"] = participant_name
        self.entries.append(entry)
        self._schedule_flush()

    def update_metadata(self, metadata: dict) -> None:
        for key, value in metadata.items():
            if value is not None:
                self.metadata[key] = value
        self._schedule_flush()

    def flush_now(self) -> None:
        self._flush_sync()

    @property
    def closed(self) -> bool:
        return self._closed

    def close(self) -> None:
        self._flush_sync()
        if self._closed:
            return
        self._closed = True
        if self._supabase_writer is not None:
            self._safe_supabase_call(
                "session close",
                self._supabase_writer.end_session,
                self.metadata,
            )

    def _schedule_flush(self) -> None:
        """1초 디바운스: 동일 윈도우 내 다수 log() 호출을 단일 disk write로 통합.
        stream consumer(route.ts)가 1초 간격 polling이므로 지연 없음."""
        if self._flush_task is not None and not self._flush_task.done():
            return  # 이미 예약됨 — 기존 태스크가 최신 entries를 씀
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._flush_sync()  # 이벤트 루프 없는 환경 fallback
            return
        self._flush_task = loop.create_task(self._flush_after_delay())

    async def _flush_after_delay(self) -> None:
        await asyncio.sleep(1)
        await asyncio.to_thread(self._flush_sync)

    def _flush_sync(self) -> None:
        payload = {
            "session_id": self.session_id,
            "room": self.room,
            "metadata": self.metadata,
            "entries": self.entries,
        }
        try:
            self._file_writer.write(payload)
        except Exception:
            log.exception("Conversation file log write failed: path=%s", self.path)
        self._flush_supabase_sync()

    def _start_supabase_writer(self) -> None:
        if self._supabase_writer is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._safe_supabase_call("session start", self._supabase_writer.start)
            return
        loop.create_task(
            asyncio.to_thread(
                self._safe_supabase_call,
                "session start",
                self._supabase_writer.start,
            )
        )

    def _flush_supabase_sync(self) -> None:
        if self._supabase_writer is None:
            return

        self._safe_supabase_call(
            "session metadata sync",
            self._supabase_writer.sync_session_metadata,
            self.metadata,
        )

        pending = self.entries[self._supabase_sent_count :]
        if not pending:
            return
        if self._safe_supabase_call(
            "event insert",
            self._supabase_writer.write_events,
            pending,
        ):
            self._supabase_sent_count = len(self.entries)

    def _safe_supabase_call(self, action: str, fn, *args) -> bool:
        try:
            fn(*args)
            return True
        except Exception:
            log.exception(
                "Supabase conversation log %s failed; continuing local file logging",
                action,
            )
            return False
