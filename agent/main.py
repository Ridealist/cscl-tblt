import asyncio
import logging
import json
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
from livekit.agents import llm
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from logger import ConversationLogger
from prompt import build_prompt, _clean_names

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("agent")

server = AgentServer()


class Assistant(Agent):
    def __init__(
        self,
        participant_names: list[str],
        get_names_fn,
        get_speaker_fn,
    ) -> None:
        super().__init__(instructions=build_prompt(participant_names))
        self._get_names = get_names_fn      # () -> list[str]
        self._get_speaker = get_speaker_fn  # () -> str | None

    async def on_enter(self) -> None:
        """채팅방 입장 직후 호출 — 참가자 연결 대기 후 Alex의 첫 인사 1문장 생성."""
        await asyncio.sleep(1.0)

        names = _clean_names(self._get_names())
        log.info("on_enter — participants: %s", names)

        # 참가자 목록이 반영된 시스템 프롬프트로 갱신
        await self.update_instructions(build_prompt(names))

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
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


async def _run(ctx: JobContext) -> None:
    """dispatch 공통 세션 로직."""
    ctx.log_context_fields = {"room": ctx.room.name}
    conv_logger = ConversationLogger(ctx.job.room.sid, ctx.room.name)

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
        await assistant.update_instructions(build_prompt(names))
        log.info("New participant: %s | participants now: %s", p.name or p.identity, names)

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


@server.rtc_session(agent_name="my-agent")
async def named_agent(ctx: JobContext):
    await _run(ctx)


if __name__ == "__main__":
    cli.run_app(server)
