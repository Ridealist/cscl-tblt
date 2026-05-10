"""
5턴 TBLT 주말 약속 만들기 대화 시뮬레이션 테스트.

STT/TTS 없이 LLM만 사용하므로 마이크나 브라우저 없이 실행 가능.

실행:
    cd agent
    uv run pytest tests/test_conversation.py -v
"""

import pytest
from livekit.agents import AgentSession, inference, llm

from main import Assistant

TEST_PARTICIPANTS = ["Junbo", "Minji"]


def _llm() -> llm.LLM:
    return inference.LLM(model="openai/gpt-4.1-mini")


class _TestAssistant(Assistant):
    """on_enter 자동 인사를 건너뛰는 테스트 전용 서브클래스."""

    async def on_enter(self) -> None:
        pass


def _make_assistant() -> _TestAssistant:
    """테스트용 Assistant — 2인 그룹 세션 기본값."""
    return _TestAssistant(
        participant_names=TEST_PARTICIPANTS,
        get_names_fn=lambda: TEST_PARTICIPANTS,
        get_speaker_fn=lambda: TEST_PARTICIPANTS[0],
    )


@pytest.mark.asyncio
async def test_5_turn_conversation() -> None:
    """5턴 대화가 자연스럽게 이어지는지 확인."""
    async with (
        _llm() as llm_instance,
        AgentSession(llm=llm_instance) as session,
    ):
        await session.start(_make_assistant())

        # 턴 1: 인사 및 주말 계획 시작
        result = await session.run(user_input="Hi Daisy! Are you free this weekend?")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent=(
                    "Responds in simple A1-A2 English. "
                    "May ask about one participant's schedule, share own schedule, "
                    "or involve another participant in the group conversation."
                ),
            )
        )
        result.expect.no_more_events()

        # 턴 2: 일정 공유
        result = await session.run(user_input="I am free on Saturday afternoon.")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent=(
                    "Continues the weekend planning conversation in A1-A2 English. "
                    "Acceptable responses include: acknowledging the availability, "
                    "asking the other participant about their schedule, "
                    "or sharing own Saturday schedule."
                ),
            )
        )
        result.expect.no_more_events()

        # 턴 3: 문법 오류가 포함된 발화
        result = await session.run(
            user_input="I want go to Han River. We can ride bike together."
        )
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent=(
                    "Engages with the Han River or bike riding idea in simple English. "
                    "Does not harshly correct grammar. "
                    "May agree, ask for details, or involve the other participant."
                ),
            )
        )
        result.expect.no_more_events()

        # 턴 4: 시간 제안
        result = await session.run(user_input="Let's meet at 3 o'clock.")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent=(
                    "Responds to the proposed meeting time in simple English. "
                    "May agree, express availability, or involve the other participant."
                ),
            )
        )
        result.expect.no_more_events()

        # 턴 5: 최종 계획 확인
        result = await session.run(user_input="Great! See you on Saturday at Han River!")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent=(
                    "Responds positively to the confirmed plan. "
                    "Sounds enthusiastic and friendly. Uses simple A1-A2 English."
                ),
            )
        )
        result.expect.no_more_events()
