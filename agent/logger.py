import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path

LOGS_DIR = Path(__file__).parent.parent / "logs"

log = logging.getLogger(__name__)


class ConversationLogger:
    def __init__(
        self,
        session_id: str,
        room_name: str,
        metadata: dict | None = None,
    ):
        LOGS_DIR.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%y%m%d_%H:%M")
        self.path = LOGS_DIR / f"{session_id}--{ts}.json"
        self.room = room_name
        self.session_id = session_id
        self.metadata = metadata or {}
        self.entries: list[dict] = []
        self._flush_task: asyncio.Task | None = None
        log.info("Conversation log: %s", self.path)

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
            "timestamp": datetime.now().isoformat(),
            "role": role,
            "text": text,
        }
        if participant_identity:
            entry["participant_identity"] = participant_identity
        if participant_name:
            entry["participant_name"] = participant_name
        self.entries.append(entry)
        self._schedule_flush()

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
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "session_id": self.session_id,
                    "room": self.room,
                    "metadata": self.metadata,
                    "entries": self.entries,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
