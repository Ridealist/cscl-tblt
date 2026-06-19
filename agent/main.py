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
from prompt_evaluation import (
    build_prompt_from_source as build_evaluation_prompt_from_source,
    get_opening_sentence_from_source as get_evaluation_opening_sentence_from_source,
    load_prompt_source as load_evaluation_prompt_source,
)
from prompt_pipeline import build_prompt as build_pipeline_prompt
from prompt_pipeline import _clean_names
from prompt_realtime import (
    build_prompt_from_source as build_realtime_prompt_from_source,
    get_opening_sentence_from_source as get_realtime_opening_sentence_from_source,
    load_prompt_source as load_realtime_prompt_source,
    normalize_feedback_condition as normalize_realtime_feedback_condition,
    normalize_role as normalize_realtime_role,
)
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
    role = raw.get("agentRole", raw.get("agentStance")) if isinstance(raw, dict) else None
    return (
        "realtime" if mode == "realtime" else "pipeline",
        normalize_realtime_role(role if isinstance(role, str) else None),
    )


DEFAULT_AGENT_WORKER_MODE, DEFAULT_AGENT_ROLE = _read_runtime_agent_defaults()
AGENT_WORKER_MODE = os.environ.get("AGENT_WORKER_MODE", DEFAULT_AGENT_WORKER_MODE).strip().lower()
AGENT_ROLE = normalize_realtime_role(
    os.environ.get("AGENT_ROLE", os.environ.get("AGENT_STANCE", DEFAULT_AGENT_ROLE))
    .strip()
    .lower()
)
REALTIME_AGENT_NAMES = {
    "dominant": "realtime-agent",
    "collaborative": "realtime-agent",
}
REALTIME_AGENT_NAME = "realtime-agent"
REALTIME_TTS_VOICE_BY_SESSION_PURPOSE = {
    "evaluation": "b7d50908-b17c-442d-ad8d-810c63997ed9",  # Kate / Sierra - California Girl
    "practice": "b7d50908-b17c-442d-ad8d-810c63997ed9",  # Kate / Sierra - California Girl
}
REALTIME_TTS_EXTRA_KWARGS_BY_SESSION_PURPOSE = {
    "evaluation": {
        "speed": 0.8,
        "volume": 1.0,
        # "emotion": "excited",
    },
    "practice": {
        "speed": 0.8,
        "volume": 1.1,
        # "emotion": "excited",
    },
}

log.info(
    "Agent worker configuration: worker_mode=%s role=%s default_mode=%s default_role=%s "
    "livekit_url_set=%s openai_key_set=%s",
    AGENT_WORKER_MODE,
    AGENT_ROLE,
    DEFAULT_AGENT_WORKER_MODE,
    DEFAULT_AGENT_ROLE,
    bool(os.environ.get("LIVEKIT_URL")),
    bool(os.environ.get("OPENAI_API_KEY")),
)


def _resolve_realtime_worker() -> tuple[str, str]:
    if AGENT_WORKER_MODE in ("realtime-collaborative", "realtime-passive"):
        return "collaborative", REALTIME_AGENT_NAME
    if AGENT_WORKER_MODE == "realtime-dominant":
        return "dominant", REALTIME_AGENT_NAME
    return AGENT_ROLE, REALTIME_AGENT_NAME


def _metadata_role(metadata) -> str | None:
    if not metadata:
        return None
    try:
        parsed = json.loads(metadata) if isinstance(metadata, str) else metadata
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    role = parsed.get("agentRole", parsed.get("agentStance"))
    if role in ("dominant", "collaborative", "passive"):
        return normalize_realtime_role(role)
    return None


def _metadata_task_card_id(metadata) -> str | None:
    if not metadata:
        return None
    try:
        parsed = json.loads(metadata) if isinstance(metadata, str) else metadata
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    task_card_id = parsed.get("taskCardId")
    return task_card_id.strip() if isinstance(task_card_id, str) and task_card_id.strip() else None


def _metadata_feedback_condition_id(metadata) -> str | None:
    if not metadata:
        return None
    try:
        parsed = json.loads(metadata) if isinstance(metadata, str) else metadata
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    feedback_condition_id = parsed.get("feedbackConditionId")
    return (
        normalize_realtime_feedback_condition(feedback_condition_id)
        if isinstance(feedback_condition_id, str) and feedback_condition_id.strip()
        else None
    )


def _metadata_prompt_version_id(metadata) -> str | None:
    if not metadata:
        return None
    try:
        parsed = json.loads(metadata) if isinstance(metadata, str) else metadata
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    version_id = parsed.get("promptVersionId") or parsed.get("evaluationPromptVersionId")
    if not isinstance(version_id, str) or not version_id.strip():
        version_id = parsed.get("promptId") if parsed.get("promptSource") == "custom" else None
    if not isinstance(version_id, str) or not version_id.strip():
        evaluation_prompt_id = parsed.get("evaluationPromptId")
        evaluation_id = parsed.get("evaluationId")
        if (
            parsed.get("sessionPurpose") == "evaluation"
            and isinstance(evaluation_prompt_id, str)
            and evaluation_prompt_id.strip()
            and evaluation_prompt_id != evaluation_id
        ):
            version_id = evaluation_prompt_id
    if not isinstance(version_id, str):
        return None
    version_id = version_id.strip()
    return version_id if version_id and version_id != "default" else None


def _metadata_student_context(metadata) -> dict:
    if not metadata:
        return {}
    try:
        parsed = json.loads(metadata) if isinstance(metadata, str) else metadata
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}

    values = {
        "student_id": parsed.get("studentId"),
        "student_number": parsed.get("studentNumber"),
        "student_name": parsed.get("studentName"),
        "student_display_name": parsed.get("studentDisplayName"),
        "student_class_number": parsed.get("studentClassNumber"),
        "student_roll_number": parsed.get("studentRollNumber"),
    }
    return {
        key: value
        for key, value in values.items()
        if isinstance(value, (str, int)) and str(value).strip()
    }


def _metadata_activity_context(metadata) -> dict:
    if not metadata:
        return {}
    try:
        parsed = json.loads(metadata) if isinstance(metadata, str) else metadata
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}

    session_purpose = parsed.get("sessionPurpose")
    activity_type = parsed.get("activityType")
    values = {
        "session_purpose": session_purpose
        if session_purpose in ("evaluation", "practice", "execution")
        else None,
        "activity_type": activity_type
        if activity_type in ("free_conversation", "task_solution")
        else None,
        "evaluation_id": parsed.get("evaluationId"),
        "evaluation_prompt_id": parsed.get("evaluationPromptId"),
        "evaluation_prompt_version": parsed.get("evaluationPromptVersion"),
        "evaluation_prompt_version_id": parsed.get("evaluationPromptVersionId")
        or parsed.get("promptVersionId"),
        "evaluation_character": parsed.get("evaluationCharacter"),
    }
    return {
        key: value
        for key, value in values.items()
        if isinstance(value, str) and value.strip()
    }


def _realtime_tts_voice_for_session_purpose(session_purpose: str | None) -> str:
    return REALTIME_TTS_VOICE_BY_SESSION_PURPOSE.get(
        session_purpose or "practice",
        REALTIME_TTS_VOICE_BY_SESSION_PURPOSE["practice"],
    )


def _realtime_tts_extra_kwargs_for_session_purpose(session_purpose: str | None) -> dict:
    return dict(
        REALTIME_TTS_EXTRA_KWARGS_BY_SESSION_PURPOSE.get(
            session_purpose or "practice",
            REALTIME_TTS_EXTRA_KWARGS_BY_SESSION_PURPOSE["practice"],
        )
    )


def _resolve_realtime_job_role(ctx: JobContext, fallback: str) -> str:
    for metadata in (
        getattr(ctx.job, "metadata", None),
        getattr(ctx.room, "metadata", None),
        getattr(getattr(ctx.job, "room", None), "metadata", None),
    ):
        role = _metadata_role(metadata)
        if role:
            return role
    return normalize_realtime_role(fallback)


def _resolve_realtime_task_card_id(ctx: JobContext) -> str | None:
    for metadata in (
        getattr(ctx.job, "metadata", None),
        getattr(ctx.room, "metadata", None),
        getattr(getattr(ctx.job, "room", None), "metadata", None),
    ):
        task_card_id = _metadata_task_card_id(metadata)
        if task_card_id:
            return task_card_id
    return None


def _resolve_realtime_feedback_condition_id(ctx: JobContext) -> str | None:
    for metadata in (
        getattr(ctx.job, "metadata", None),
        getattr(ctx.room, "metadata", None),
        getattr(getattr(ctx.job, "room", None), "metadata", None),
    ):
        feedback_condition_id = _metadata_feedback_condition_id(metadata)
        if feedback_condition_id:
            return feedback_condition_id
    return None


def _resolve_realtime_prompt_version_id(ctx: JobContext) -> str | None:
    for metadata in (
        getattr(ctx.job, "metadata", None),
        getattr(ctx.room, "metadata", None),
        getattr(getattr(ctx.job, "room", None), "metadata", None),
    ):
        prompt_version_id = _metadata_prompt_version_id(metadata)
        if prompt_version_id:
            return prompt_version_id
    return None


def _resolve_realtime_student_context(ctx: JobContext) -> dict:
    for metadata in (
        getattr(ctx.job, "metadata", None),
        getattr(ctx.room, "metadata", None),
        getattr(getattr(ctx.job, "room", None), "metadata", None),
    ):
        student_context = _metadata_student_context(metadata)
        if student_context:
            return student_context
    return {}


def _resolve_realtime_activity_context(ctx: JobContext) -> dict:
    for metadata in (
        getattr(ctx.job, "metadata", None),
        getattr(ctx.room, "metadata", None),
        getattr(getattr(ctx.job, "room", None), "metadata", None),
    ):
        activity_context = _metadata_activity_context(metadata)
        if activity_context:
            return _normalize_activity_context(activity_context)

    room_name = getattr(ctx.room, "name", "")
    if isinstance(room_name, str) and (
        room_name.startswith("eval-") or room_name.startswith("eval_")
    ):
        return {
            "activity_type": "free_conversation",
            "evaluation_id": "pretest_6_10",
            "session_purpose": "evaluation",
        }
    return {
        "activity_type": "task_solution",
        "session_purpose": "practice",
    }


def _normalize_activity_context(activity_context: dict) -> dict:
    activity_type = activity_context.get("activity_type")
    session_purpose = activity_context.get("session_purpose")
    if activity_type == "free_conversation" or session_purpose == "evaluation":
        session_purpose = "evaluation"
        activity_type = "free_conversation"
    elif session_purpose != "evaluation":
        session_purpose = "practice"
        activity_type = "task_solution" if activity_type != "task_solution" else activity_type

    normalized = {
        **activity_context,
        "activity_type": activity_type,
        "session_purpose": session_purpose,
    }
    return {
        key: value
        for key, value in normalized.items()
        if isinstance(value, str) and value.strip()
    }


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
        """채팅방 입장 직후 호출 — 참가자 연결 대기 후 Kate의 첫 인사 1문장 생성."""
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


async def _shutdown_session(egress: EgressRecorder, conv_logger: ConversationLogger) -> None:
    if conv_logger.closed:
        return
    await egress.stop()
    await asyncio.to_thread(conv_logger.close)


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
    if egress.egress_id:
        conv_logger.update_metadata(
            {
                "egress_id": egress.egress_id,
                "recording_path": egress.filepath,
            }
        )

    # 룸 종료 시 Egress 자동 중지
    ctx.room.on(
        "disconnected",
        lambda: asyncio.ensure_future(_shutdown_session(egress, conv_logger)),
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

    async def on_participant_disconnected(p):
        participant_names.pop(p.identity, None)
        if _human_names():
            return
        log.info(
            "Pipeline conversation ending because all participants left: room=%s session_id=%s",
            ctx.room.name,
            conv_logger.session_id,
        )
        await _shutdown_session(egress, conv_logger)

    ctx.room.on(
        "participant_disconnected",
        lambda p: asyncio.ensure_future(on_participant_disconnected(p)),
    )


class RealtimeAssistant(Agent):
    def __init__(
        self,
        get_name_fn,
        role: str,
        prompt_source,
        build_prompt_fn,
        get_opening_sentence_fn,
    ) -> None:
        self._get_name = get_name_fn
        self._role = role
        self._prompt_source = prompt_source
        self._build_prompt = build_prompt_fn
        self._task_card_id = getattr(prompt_source, "task_card_id", None)
        self._feedback_condition_id = getattr(prompt_source, "feedback_condition", None)
        self._prompt_version_id = getattr(prompt_source, "prompt_version_id", None)
        self._opening_sentence = get_opening_sentence_fn(prompt_source)
        super().__init__(instructions=self.build_instructions(None))

    def build_instructions(self, name: str | None) -> str:
        return self._build_prompt(
            self._prompt_source,
            name,
            role=self._role,
        )

    async def on_enter(self) -> None:
        """1:1 realtime 세션 입장 직후 참가자 이름을 반영하고 첫 턴을 생성."""
        await asyncio.sleep(1.0)
        name = self._get_name()
        log.info(
            "Realtime assistant entering session: role=%s feedback_condition_id=%s "
            "task_card_id=%s prompt_source=%s prompt_version_id=%s participant_name=%s",
            self._role,
            self._feedback_condition_id,
            self._task_card_id,
            self._prompt_source.source,
            self._prompt_version_id,
            name,
        )
        await self.update_instructions(self.build_instructions(name))

        character = getattr(self._prompt_source, "evaluation_character", None) or "Kate"
        instruction = (
            f"Say only this exact opening as {character}, a friendly classmate, and nothing else: "
            f"{json.dumps(self._opening_sentence, ensure_ascii=False)}"
        )
        log.info("Realtime first reply requested: %s", self._opening_sentence)
        self.session.generate_reply(instructions=instruction)


async def _run_realtime(ctx: JobContext, role: str) -> None:
    """1:1 OpenAI Realtime 세션 로직."""
    role = _resolve_realtime_job_role(ctx, fallback=role)
    task_card_id = _resolve_realtime_task_card_id(ctx)
    feedback_condition_id = _resolve_realtime_feedback_condition_id(ctx)
    prompt_version_id = _resolve_realtime_prompt_version_id(ctx)
    student_context = _resolve_realtime_student_context(ctx)
    activity_context = _resolve_realtime_activity_context(ctx)
    is_evaluation = activity_context.get("session_purpose") == "evaluation"
    if is_evaluation:
        evaluation_prompt_version_id = (
            activity_context.get("evaluation_prompt_version_id") or prompt_version_id
        )
        prompt_source = await asyncio.to_thread(
            load_evaluation_prompt_source,
            activity_context.get("evaluation_id"),
            evaluation_prompt_version_id,
        )
        activity_context = {
            **activity_context,
            "evaluation_id": prompt_source.evaluation_id,
            "evaluation_prompt_id": prompt_source.evaluation_prompt_id,
            "evaluation_prompt_version": prompt_source.evaluation_prompt_version,
            "evaluation_prompt_version_id": prompt_source.prompt_version_id,
            "evaluation_character": prompt_source.evaluation_character,
        }
        build_prompt_fn = build_evaluation_prompt_from_source
        get_opening_sentence_fn = get_evaluation_opening_sentence_from_source
        resolved_task_card_id = None
        resolved_feedback_condition_id = None
    else:
        prompt_source = await asyncio.to_thread(
            load_realtime_prompt_source,
            task_card_id,
            feedback_condition_id,
            prompt_version_id,
        )
        build_prompt_fn = build_realtime_prompt_from_source
        get_opening_sentence_fn = get_realtime_opening_sentence_from_source
        resolved_task_card_id = prompt_source.task_card_id or task_card_id
        resolved_feedback_condition_id = prompt_source.feedback_condition
    tts_voice = _realtime_tts_voice_for_session_purpose(activity_context.get("session_purpose"))
    tts_extra_kwargs = _realtime_tts_extra_kwargs_for_session_purpose(
        activity_context.get("session_purpose")
    )
    ctx.log_context_fields = {
        "room": ctx.room.name,
        "mode": "realtime",
        "role": role,
        "session_purpose": activity_context.get("session_purpose"),
        "activity_type": activity_context.get("activity_type"),
        "feedback_condition_id": resolved_feedback_condition_id,
        "prompt_source": prompt_source.source,
        "prompt_version_id": prompt_source.prompt_version_id,
        "tts_voice_id": tts_voice,
        "tts_speed": tts_extra_kwargs["speed"],
        "tts_volume": tts_extra_kwargs["volume"],
    }
    log.info(
        "Starting realtime job: room=%s room_sid=%s job_id=%s role=%s "
        "session_purpose=%s activity_type=%s feedback_condition_id=%s "
        "task_card_id=%s prompt_source=%s prompt_version_id=%s tts_voice_id=%s "
        "tts_speed=%s tts_volume=%s metadata=%s",
        ctx.room.name,
        ctx.job.room.sid,
        getattr(ctx.job, "id", None),
        role,
        activity_context.get("session_purpose"),
        activity_context.get("activity_type"),
        resolved_feedback_condition_id,
        resolved_task_card_id,
        prompt_source.source,
        prompt_source.prompt_version_id,
        tts_voice,
        tts_extra_kwargs["speed"],
        tts_extra_kwargs["volume"],
        getattr(ctx.job, "metadata", None),
    )
    prompt_metadata = (
        {
            "evaluation_id": activity_context.get("evaluation_id"),
            "evaluation_prompt_id": activity_context.get("evaluation_prompt_id"),
            "evaluation_prompt_version": activity_context.get("evaluation_prompt_version"),
            "evaluation_character": activity_context.get("evaluation_character"),
            "prompt_id": activity_context.get("evaluation_prompt_id"),
            "prompt_version_id": prompt_source.prompt_version_id,
            "prompt_saved_at": prompt_source.saved_at,
            "prompt_source": prompt_source.source,
        }
        if is_evaluation
        else {
            "agent_role": role,
            "feedback_condition_id": resolved_feedback_condition_id,
            "task_card_id": resolved_task_card_id,
            "prompt_source": prompt_source.source,
            "prompt_id": prompt_source.prompt_version_id or "default",
            "prompt_version_id": prompt_source.prompt_version_id,
            "prompt_saved_at": prompt_source.saved_at,
        }
    )
    conv_logger = ConversationLogger(
        ctx.job.room.sid,
        ctx.room.name,
        metadata={
            "agent_mode": "realtime",
            "activity_type": activity_context.get("activity_type"),
            "session_purpose": activity_context.get("session_purpose"),
            "tts_voice_id": tts_voice,
            "tts_speed": tts_extra_kwargs["speed"],
            "tts_volume": tts_extra_kwargs["volume"],
            **prompt_metadata,
            **student_context,
        },
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

    assistant = RealtimeAssistant(
        get_name_fn=lambda: participant["name"],
        role=role,
        prompt_source=prompt_source,
        build_prompt_fn=build_prompt_fn,
        get_opening_sentence_fn=get_opening_sentence_fn,
    )

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
            language="en",
            voice=tts_voice,
            # voice="e3827ec5-697a-4b7c-9704-1a23041bbc51", # Dottie
            # voice="df872fcd-da17-4b01-a49f-a80d7aaee95e", # Cameron
            # voice="c58bda25-abd5-4c72-97a2-4dbe049b368d", # Garrett
            # voice="f4a3a8e4-694c-4c45-9ca0-27caf97901b5", # Gavin
            extra_kwargs=tts_extra_kwargs,
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

    log.info("Starting realtime AgentSession: room=%s role=%s", ctx.room.name, role)
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(),
        ),
    )
    log.info("Realtime AgentSession started: room=%s role=%s", ctx.room.name, role)

    await egress.start()
    if egress.egress_id:
        conv_logger.update_metadata(
            {
                "egress_id": egress.egress_id,
                "recording_path": egress.filepath,
            }
        )
    log.info("Realtime egress started: room=%s session_id=%s", ctx.room.name, conv_logger.session_id)

    ctx.room.on(
        "disconnected",
        lambda: asyncio.ensure_future(_shutdown_session(egress, conv_logger)),
    )

    for p in ctx.room.remote_participants.values():
        _register_participant(p)
        break

    async def on_participant_connected(p):
        if participant["identity"] is None:
            _register_participant(p)
            await assistant.update_instructions(assistant.build_instructions(participant["name"]))
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

    async def on_participant_disconnected(p):
        if participant["identity"] != p.identity:
            return
        participant["identity"] = None
        participant["name"] = None
        log.info(
            "Realtime conversation ending because participant left: room=%s session_id=%s identity=%s",
            ctx.room.name,
            conv_logger.session_id,
            p.identity,
        )
        await _shutdown_session(egress, conv_logger)

    ctx.room.on(
        "participant_disconnected",
        lambda p: asyncio.ensure_future(on_participant_disconnected(p)),
    )


if AGENT_WORKER_MODE.startswith("realtime"):

    REALTIME_ROLE, REALTIME_AGENT_NAME = _resolve_realtime_worker()
    log.info(
        "Registering LiveKit rtc_session: agent_name=%s worker_mode=%s fallback_role=%s",
        REALTIME_AGENT_NAME,
        AGENT_WORKER_MODE,
        REALTIME_ROLE,
    )

    @server.rtc_session(agent_name=REALTIME_AGENT_NAME)
    async def selected_agent(ctx: JobContext):
        try:
            await _run_realtime(ctx, REALTIME_ROLE)
        except Exception:
            log.exception(
                "Realtime job failed: agent_name=%s room=%s role=%s",
                REALTIME_AGENT_NAME,
                ctx.room.name,
                REALTIME_ROLE,
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
