import json
import logging
from datetime import datetime
from pathlib import Path

LOGS_DIR = Path(__file__).parent.parent / "logs"

log = logging.getLogger(__name__)


class ConversationLogger:
    def __init__(self, session_id: str, room_name: str):
        LOGS_DIR.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%y%m%d_%H:%M")
        self.path = LOGS_DIR / f"{session_id}--{ts}.json"
        self.room = room_name
        self.session_id = session_id
        self.entries: list[dict] = []
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
        self._save()

    def _save(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(
                {"session_id": self.session_id, "room": self.room, "entries": self.entries},
                f,
                ensure_ascii=False,
                indent=2,
            )
