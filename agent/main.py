import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
)
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from logger import ConversationLogger
from prompt import SYSTEM_PROMPT

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("agent")

# AGENT_MODE: "pipeline" (STT-LLM-TTS) 또는 "realtime" (OpenAI Realtime API)
AGENT_MODE = os.getenv("AGENT_MODE", "pipeline")

log.info("Agent mode: %s", AGENT_MODE)

server = AgentServer()


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


def prewarm(proc: JobProcess):
    # Silero VAD는 pipeline 모드에서만 필요
    if AGENT_MODE == "pipeline":
        proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


async def _run(ctx: JobContext) -> None:
    """자동/수동 dispatch 공통 세션 로직."""
    ctx.log_context_fields = {"room": ctx.room.name}
    conv_logger = ConversationLogger(ctx.job.room.sid, ctx.room.name)

    # 참가자 registry: identity -> name
    participant_names: dict[str, str] = {}

    def _register_participant(p) -> None:
        participant_names[p.identity] = p.name or p.identity

    # 이미 연결된 참가자 등록 (에이전트 자신 포함)
    for p in ctx.room.remote_participants.values():
        _register_participant(p)

    ctx.room.on("participant_connected", lambda p: _register_participant(p))

    # 현재 발화 중인 참가자 (로컬 에이전트 제외한 유저)
    current_speaker: dict[str, str | None] = {"identity": None, "name": None}

    if AGENT_MODE == "realtime":
        from livekit.plugins import openai as openai_plugin

        session = AgentSession(
            llm=openai_plugin.realtime.RealtimeModel(voice="coral"),
        )
    else:
        session = AgentSession(
            stt=inference.STT(model="deepgram/nova-3", language="multi"),
            llm=inference.LLM(model="openai/gpt-4o-mini"),
            tts=inference.TTS(
                model="cartesia/sonic-3", voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
            ),
            turn_detection=MultilingualModel(),
            vad=ctx.proc.userdata["vad"],
            preemptive_generation=True,
        )

    @session.on("conversation_item_added")
    def on_conversation_item(ev):
        item = ev.item
        if not hasattr(item, "role") or not hasattr(item, "text_content"):
            return
        text = item.text_content
        if not text:
            return

        if item.role == "user":
            conv_logger.log(
                role="user",
                text=text,
                participant_identity=current_speaker["identity"],
                participant_name=current_speaker["name"],
            )
        elif item.role == "assistant":
            conv_logger.log(role="agent", text=text)

    await session.start(
        agent=Assistant(),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(),
        ),
    )
    await ctx.connect()

    # Active speaker가 바뀔 때마다 current_speaker와 linked participant를 갱신
    def on_active_speakers_changed(speakers):
        if not speakers:
            return
        local_identity = ctx.room.local_participant.identity
        for speaker in speakers:
            if speaker.identity != local_identity:
                # room_io 실패와 무관하게 항상 발화자 기록
                current_speaker["identity"] = speaker.identity
                current_speaker["name"] = participant_names.get(
                    speaker.identity, speaker.identity
                )
                try:
                    session.room_io.set_participant(speaker.identity)
                except RuntimeError:
                    pass
                break

    ctx.room.on("active_speakers_changed", on_active_speakers_changed)

    GREETING = (
        "Hello! I'm your English speaking practice partner. "
        "Feel free to start talking whenever you're ready!"
    )

    if AGENT_MODE == "realtime":
        # Realtime 모드: 별도 TTS 없이 모델이 직접 음성 생성
        await session.generate_reply(instructions=GREETING)
    else:
        await session.say(GREETING)


@server.rtc_session(agent_name="my-agent")
async def named_agent(ctx: JobContext):
    """수동 dispatch: /dispatch 엔드포인트 호출 시 실행."""
    await _run(ctx)


if __name__ == "__main__":
    cli.run_app(server)
