import logging
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

server = AgentServer()


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


async def _run(ctx: JobContext) -> None:
    """자동/수동 dispatch 공통 세션 로직."""
    ctx.log_context_fields = {"room": ctx.room.name}
    conv_logger = ConversationLogger(ctx.room.name)

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

    @session.on("user_speech_committed")
    def on_user_speech(ev):
        text = getattr(ev, "transcript", "") or getattr(ev, "text", "")
        if text:
            conv_logger.log("user", text)

    @session.on("agent_speech_committed")
    def on_agent_speech(ev):
        text = getattr(ev, "transcript", "") or getattr(ev, "text", "")
        if text:
            conv_logger.log("agent", text)

    await session.start(
        agent=Assistant(),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(),
        ),
    )
    await ctx.connect()

    # Active speaker가 바뀔 때마다 linked participant를 전환
    def on_active_speakers_changed(speakers):
        if not speakers:
            return
        local_identity = ctx.room.local_participant.identity
        for speaker in speakers:
            if speaker.identity != local_identity:
                session.room_io.set_participant(speaker.identity)
                break

    ctx.room.on("active_speakers_changed", on_active_speakers_changed)

    await session.say(
        "Hello! I'm your English speaking practice partner. "
        "Feel free to start talking whenever you're ready!"
    )


# @server.rtc_session()
# async def auto_agent(ctx: JobContext):
#     """자동 dispatch: 참가자가 입장하면 LiveKit Cloud가 자동으로 실행."""
#     await _run(ctx)


@server.rtc_session(agent_name="my-agent")
async def named_agent(ctx: JobContext):
    """수동 dispatch: /dispatch 엔드포인트 호출 시 실행."""
    await _run(ctx)


if __name__ == "__main__":
    cli.run_app(server)
