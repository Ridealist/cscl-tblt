import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from livekit.api import AccessToken, VideoGrants, LiveKitAPI
from livekit.protocol.agent_dispatch import CreateAgentDispatchRequest

load_dotenv(Path(__file__).parent.parent / ".env")

LIVEKIT_URL = os.environ["LIVEKIT_URL"]
API_KEY = os.environ["LIVEKIT_API_KEY"]
API_SECRET = os.environ["LIVEKIT_API_SECRET"]
ROOM_NAME = os.environ.get("ROOM_NAME", "english-practice")
AGENT_NAME = "my-agent"

LOGS_DIR = Path(__file__).parent.parent / "logs"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/token")
def get_token(name: str = Query(..., description="참가자 이름")):
    if not name.strip():
        raise HTTPException(status_code=400, detail="name은 비워둘 수 없습니다.")

    token = (
        AccessToken(API_KEY, API_SECRET)
        .with_identity(name)
        .with_name(name)
        .with_grants(
            VideoGrants(
                room_join=True,
                room=ROOM_NAME,
                can_publish=True,
                can_publish_data=True,
                can_subscribe=True,
            )
        )
        .to_jwt()
    )

    return {
        "token": token,
        "url": LIVEKIT_URL,
        "room": ROOM_NAME,
    }


@app.get("/logs/stream")
async def stream_logs(request: Request):
    """관리자용 실시간 로그 스트리밍 (SSE)."""
    async def generator():
        last_mtime: float | None = None
        last_path: Path | None = None

        while not await request.is_disconnected():
            log_files = sorted(
                LOGS_DIR.glob("*.json"),
                key=lambda f: f.stat().st_mtime,
            )
            if log_files:
                latest = log_files[-1]
                mtime = latest.stat().st_mtime
                if latest != last_path or mtime != last_mtime:
                    try:
                        data = json.loads(latest.read_text(encoding="utf-8"))
                        data["_filename"] = latest.name
                        yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
                    except Exception:
                        pass
                    last_path = latest
                    last_mtime = mtime

            await asyncio.sleep(1)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/dispatch")
async def dispatch_agent():
    """에이전트를 room에 수동으로 추가합니다."""
    try:
        async with LiveKitAPI(LIVEKIT_URL, API_KEY, API_SECRET) as lk:
            await lk.agent_dispatch.create_dispatch(
                CreateAgentDispatchRequest(
                    room=ROOM_NAME,
                    agent_name=AGENT_NAME,
                )
            )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
