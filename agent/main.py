import asyncio
import logging
import json
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
    room_io,
    llm,
    inference
)
from livekit.plugins import openai

from egress_recorder import EgressRecorder
from logger import ConversationLogger
from prompt_pipeline import build_prompt as build_pipeline_prompt
from prompt_pipeline import _clean_names
from prompt_realtime import build_prompt as build_realtime_prompt
from prompt_realtime import normalize_stance as normalize_realtime_stance
from openai.types.beta.realtime.session import TurnDetection

load_dotenv(Path(__file__).parent.parent / ".env")

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
logging.getLogger("livekit").setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
logging.getLogger("livekit.agents").setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
log = logging.getLogger("agent")

server = AgentServer()
CONFIG_PATH = Path(__file__).parent.parent / "config.json"


def _read_runtime_agent_defaults() -> tuple[str, str]:
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        log.info("Runtime config unavailable; defaulting agent worker to pipeline: %s", exc)
        return "pipeline", "dominant"

    mode = raw.get("agentMode") if isinstance(raw, dict) else None
    stance = raw.get("agentStance") if isinstance(raw, dict) else None
    return (
        "realtime" if mode == "realtime" else "pipeline",
        "passive" if stance == "passive" else "dominant",
    )


DEFAULT_AGENT_WORKER_MODE, DEFAULT_AGENT_STANCE = _read_runtime_agent_defaults()
AGENT_WORKER_MODE = os.environ.get("AGENT_WORKER_MODE", DEFAULT_AGENT_WORKER_MODE).strip().lower()
AGENT_STANCE = normalize_realtime_stance(
    os.environ.get("AGENT_STANCE", DEFAULT_AGENT_STANCE).strip().lower()
)
REALTIME_AGENT_NAMES = {
    "dominant": "realtime-agent",
    "passive": "realtime-agent",
}
REALTIME_AGENT_NAME = "realtime-agent"
REALTIME_FIRST_SENTENCE = (
    "Hi, I'm Daisy. I moved from the United States to Myo-gok Elementary School, "
    "and I'm in 6th grade like you. What is your name?"
)

log.info(
    "Agent worker configuration: worker_mode=%s stance=%s default_mode=%s default_stance=%s "
    "livekit_url_set=%s openai_key_set=%s",
    AGENT_WORKER_MODE,
    AGENT_STANCE,
    DEFAULT_AGENT_WORKER_MODE,
    DEFAULT_AGENT_STANCE,
    bool(os.environ.get("LIVEKIT_URL")),
    bool(os.environ.get("OPENAI_API_KEY")),
)


def _resolve_realtime_worker() -> tuple[str, str]:
    if AGENT_WORKER_MODE == "realtime-passive":
        return "passive", REALTIME_AGENT_NAME
    if AGENT_WORKER_MODE == "realtime-dominant":
        return "dominant", REALTIME_AGENT_NAME
    return AGENT_STANCE, REALTIME_AGENT_NAME


def _metadata_stance(metadata) -> str | None:
    if not metadata:
        return None
    try:
        parsed = json.loads(metadata) if isinstance(metadata, str) else metadata
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    stance = parsed.get("agentStance")
    if stance in ("dominant", "passive"):
        return normalize_realtime_stance(stance)
    return None


def _resolve_realtime_job_stance(ctx: JobContext, fallback: str) -> str:
    for metadata in (
        getattr(ctx.job, "metadata", None),
        getattr(ctx.room, "metadata", None),
        getattr(getattr(ctx.job, "room", None), "metadata", None),
    ):
        stance = _metadata_stance(metadata)
        if stance:
            return stance
    return normalize_realtime_stance(fallback)


class Assistant(Agent):
    def __init__(
        self,
        participant_names: list[str],
        get_names_fn,
        get_speaker_fn,
    ) -> None:
        super().__init__(instructions=build_pipeline_prompt(participant_names))
        self._get_names = get_names_fn      # () -> list[str]
        self._get_speaker = get_speaker_fn  # () -> str | None

    async def on_enter(self) -> None:
        """채팅방 입장 직후 호출 — 참가자 연결 대기 후 Daisy의 첫 인사 1문장 생성."""
        await asyncio.sleep(1.0)

        names = _clean_names(self._get_names())
        log.info("on_enter — participants: %s", names)

        # 참가자 목록이 반영된 시스템 프롬프트로 갱신
        await self.update_instructions(build_pipeline_prompt(names))

        if not names:
            first_sentence = "Hi, are you free this weekend?"
        elif len(names) == 1:
            first_sentence = f"Hi {names[0]}, are you free this weekend?"
        else:
            name_list = ", ".join(names[:-1]) + f" and {names[-1]}"
            first_sentence = f"Hi {name_list}, are you free this weekend?"

        instruction = (
            "Say only this one sentence in A1-A2 English and nothing else: "
            f"{json.dumps(first_sentence, ensure_ascii=False)}"
        )
        self.session.generate_reply(instructions=instruction)

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        """STT 완료 후 LLM 호출 전 — 발화자 태그를 대화 이력에 영구 삽입."""
        speaker = self._get_speaker()
        text = new_message.text_content
        if speaker and text:
            new_message.content = [f"[{speaker}]: {text}"]
            log.info("Speaker tag injected: [%s]", speaker)


def prewarm(proc: JobProcess):
    from livekit.plugins import silero

    log.info("Prewarming agent process resources")
    proc.userdata["vad"] = silero.VAD.load()


async def _run(ctx: JobContext) -> None:
    """dispatch 공통 세션 로직."""
    ctx.log_context_fields = {"room": ctx.room.name}
    log.info(
        "Starting pipeline job: room=%s room_sid=%s job_id=%s",
        ctx.room.name,
        ctx.job.room.sid,
        getattr(ctx.job, "id", None),
    )
    conv_logger = ConversationLogger(
        ctx.job.room.sid,
        ctx.room.name,
        metadata={"agent_mode": "pipeline"},
    )
    egress = EgressRecorder(ctx.room.name, conv_logger.session_id)

    # 참가자 registry: identity → name
    participant_names: dict[str, str] = {}

    def _register_participant(p) -> None:
        full_name = p.name or p.identity
        # 이름(First Name)만 사용 — "Junbo Koh" → "Junbo"
        participant_names[p.identity] = full_name.split()[0] if full_name else full_name

    # 현재 발화자 추적
    current_speaker: dict[str, str | None] = {"identity": None, "name": None}

    def _human_names() -> list[str]:
        """에이전트 자신을 제외한 사람 참가자 이름 목록 (connect 이후 안전)."""
        try:
            local_id = ctx.room.local_participant.identity
        except Exception:
            local_id = None
        return [
            name
            for identity, name in participant_names.items()
            if identity != local_id
        ]

    assistant = Assistant(
        participant_names=list(participant_names.values()),
        get_names_fn=_human_names,
        get_speaker_fn=lambda: current_speaker["name"],
    )

    from livekit.plugins.turn_detector.multilingual import MultilingualModel

    #TODO Agent 설정 조정(STT/LLM/TTS 모델 설정)
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(
            model="cartesia/sonic-3", voice="a167e0f3-df7e-4d52-a9c3-f949145efdab"
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

    # session.start()이 room_io를 통해 ctx.connect()를 자동 처리
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(),
        ),
    )

    # 룸 연결 완료 후 Egress 녹음 시작
    await egress.start()

    # 룸 종료 시 Egress 자동 중지
    ctx.room.on(
        "disconnected",
        lambda: asyncio.ensure_future(egress.stop()),
    )

    # ctx.connect()가 완료된 이후이므로 remote_participants가 확정됨
    for p in ctx.room.remote_participants.values():
        _register_participant(p)

    # ── 이벤트 핸들러 등록 ──────────────────────────────────────────────

    def on_active_speakers_changed(speakers):
        """발화자 변경 시 current_speaker 갱신 및 room_io 포커스 전환."""
        if not speakers:
            return
        try:
            local_id = ctx.room.local_participant.identity
        except Exception:
            local_id = None
        for speaker in speakers:
            if speaker.identity != local_id:
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

    async def on_participant_connected(p):
        """신규 참가자 입장 시 등록 + 프롬프트 업데이트 + 음성 환영."""
        _register_participant(p)
        names = _human_names()
        await assistant.update_instructions(build_pipeline_prompt(names))
        log.info(
            "Pipeline participant connected: room=%s identity=%s name=%s participants=%s",
            ctx.room.name,
            p.identity,
            p.name,
            names,
        )

        name = p.name or p.identity
        all_names = ", ".join(names)
        session.generate_reply(
            instructions=(
                f"{name} has just joined the session. "
                f"Welcome them by name and let everyone know the group now includes: {all_names}. "
                "Continue the conversation involving all participants."
            )
        )

    ctx.room.on(
        "participant_connected",
        lambda p: asyncio.ensure_future(on_participant_connected(p)),
    )


class RealtimeAssistant(Agent):
    def __init__(self, get_name_fn, stance: str) -> None:
        super().__init__(instructions=build_realtime_prompt(stance=stance))
        self._get_name = get_name_fn
        self._stance = stance

    async def on_enter(self) -> None:
        """1:1 realtime 세션 입장 직후 참가자 이름을 반영하고 첫 턴을 생성."""
        await asyncio.sleep(1.0)
        name = self._get_name()
        log.info(
            "Realtime assistant entering session: stance=%s participant_name=%s",
            self._stance,
            name,
        )
        await self.update_instructions(build_realtime_prompt(name, stance=self._stance))

        instruction = (
            "Say only this exact opening as Daisy, a friendly classmate, and nothing else: "
            f"{json.dumps(REALTIME_FIRST_SENTENCE, ensure_ascii=False)}"
        )
        log.info("Realtime first reply requested: %s", REALTIME_FIRST_SENTENCE)
        self.session.generate_reply(instructions=instruction)


async def _run_realtime(ctx: JobContext, stance: str) -> None:
    """1:1 OpenAI Realtime 세션 로직."""
    stance = _resolve_realtime_job_stance(ctx, fallback=stance)
    ctx.log_context_fields = {"room": ctx.room.name, "mode": "realtime", "stance": stance}
    log.info(
        "Starting realtime job: room=%s room_sid=%s job_id=%s stance=%s metadata=%s",
        ctx.room.name,
        ctx.job.room.sid,
        getattr(ctx.job, "id", None),
        stance,
        getattr(ctx.job, "metadata", None),
    )
    conv_logger = ConversationLogger(
        ctx.job.room.sid,
        ctx.room.name,
        metadata={"agent_mode": "realtime", "agent_stance": stance},
    )
    egress = EgressRecorder(ctx.room.name, conv_logger.session_id)

    participant: dict[str, str | None] = {"identity": None, "name": None}

    def _register_participant(p) -> None:
        full_name = p.name or p.identity
        participant["identity"] = p.identity
        participant["name"] = full_name.split()[0] if full_name else full_name
        log.info(
            "Realtime participant registered: room=%s identity=%s name=%s normalized_name=%s",
            ctx.room.name,
            p.identity,
            p.name,
            participant["name"],
        )

    assistant = RealtimeAssistant(get_name_fn=lambda: participant["name"], stance=stance)

    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            modalities=["text"],
            turn_detection=TurnDetection(
                type="semantic_vad",
                eagerness="medium",
                create_response=True,
                interrupt_response=True,
            )
        ),
        tts=inference.TTS(
            model="cartesia/sonic-3", 
            # voice="e3827ec5-697a-4b7c-9704-1a23041bbc51", # Dottie
            voice="32b3f3c5-7171-46aa-abe7-b598964aa793", # Daisy
            # voice="df872fcd-da17-4b01-a49f-a80d7aaee95e", # Cameron
            # voice="c58bda25-abd5-4c72-97a2-4dbe049b368d", # Garrett
            # voice="f4a3a8e4-694c-4c45-9ca0-27caf97901b5", # Gavin
            language="en",
            extra_kwargs={
                "speed": 0.8,
                "volume": 1.2,
                # "emotion": "excited"
            }
        ),
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
                participant_identity=participant["identity"],
                participant_name=participant["name"],
            )
        elif item.role == "assistant":
            conv_logger.log(role="agent", text=text)

    log.info("Starting realtime AgentSession: room=%s stance=%s", ctx.room.name, stance)
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(),
        ),
    )
    log.info("Realtime AgentSession started: room=%s stance=%s", ctx.room.name, stance)

    await egress.start()
    log.info("Realtime egress started: room=%s session_id=%s", ctx.room.name, conv_logger.session_id)

    ctx.room.on(
        "disconnected",
        lambda: asyncio.ensure_future(egress.stop()),
    )

    for p in ctx.room.remote_participants.values():
        _register_participant(p)
        break

    async def on_participant_connected(p):
        if participant["identity"] is None:
            _register_participant(p)
            await assistant.update_instructions(
                build_realtime_prompt(participant["name"], stance=stance)
            )
        else:
            log.info(
                "Realtime extra participant connected after first participant: room=%s identity=%s",
                ctx.room.name,
                p.identity,
            )

    ctx.room.on(
        "participant_connected",
        lambda p: asyncio.ensure_future(on_participant_connected(p)),
    )


if AGENT_WORKER_MODE.startswith("realtime"):

    REALTIME_STANCE, REALTIME_AGENT_NAME = _resolve_realtime_worker()
    log.info(
        "Registering LiveKit rtc_session: agent_name=%s worker_mode=%s fallback_stance=%s",
        REALTIME_AGENT_NAME,
        AGENT_WORKER_MODE,
        REALTIME_STANCE,
    )

    @server.rtc_session(agent_name=REALTIME_AGENT_NAME)
    async def selected_agent(ctx: JobContext):
        try:
            await _run_realtime(ctx, REALTIME_STANCE)
        except Exception:
            log.exception(
                "Realtime job failed: agent_name=%s room=%s stance=%s",
                REALTIME_AGENT_NAME,
                ctx.room.name,
                REALTIME_STANCE,
            )
            raise

else:
    log.info(
        "Registering LiveKit rtc_session: agent_name=pipeline-agent worker_mode=%s",
        AGENT_WORKER_MODE,
    )
    server.setup_fnc = prewarm

    @server.rtc_session(agent_name="pipeline-agent")
    async def selected_agent(ctx: JobContext):
        try:
            await _run(ctx)
        except Exception:
            log.exception("Pipeline job failed: agent_name=pipeline-agent room=%s", ctx.room.name)
            raise


if __name__ == "__main__":
    cli.run_app(server)
