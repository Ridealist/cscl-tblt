import json
import logging
from datetime import datetime
from pathlib import Path

LOGS_DIR = Path(__file__).parent.parent / "logs"

log = logging.getLogger(__name__)


class ConversationLogger:
    def __init__(self, room_name: str):
        LOGS_DIR.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.path = LOGS_DIR / f"{room_name}_{ts}.json"
        self.room = room_name
        self.entries: list[dict] = []
        log.info("Conversation log: %s", self.path)

    def log(self, role: str, text: str) -> None:
        """role: 'user' | 'agent'"""
        entry = {
            "timestamp": datetime.now().isoformat(),
            "role": role,
            "text": text,
        }
        self.entries.append(entry)
        self._save()

    def _save(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(
                {"room": self.room, "entries": self.entries},
                f,
                ensure_ascii=False,
                indent=2,
            )
