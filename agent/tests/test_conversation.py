"""
5턴 영어 말하기 연습 대화 시뮬레이션 테스트.

STT/TTS 없이 LLM만 사용하므로 마이크나 브라우저 없이 실행 가능.

실행:
    cd agent
    uv run pytest tests/test_conversation.py -v
"""

import pytest
from livekit.agents import AgentSession, inference, llm

from main import Assistant


def _llm() -> llm.LLM:
    return inference.LLM(model="openai/gpt-4o-mini")


@pytest.mark.asyncio
async def test_5_turn_conversation() -> None:
    """5턴 대화가 자연스럽게 이어지는지 확인."""
    async with (
        _llm() as llm_instance,
        AgentSession(llm=llm_instance) as session,
    ):
        await session.start(Assistant())

        # 턴 1: 인사
        result = await session.run(user_input="Hello, I want to practice my English speaking.")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent="Responds positively and asks a follow-up question to engage the student.",
            )
        )
        result.expect.no_more_events()

        # 턴 2: 주제 제안
        result = await session.run(user_input="Can we talk about my weekend activities?")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent="Agrees or responds positively, and asks a question about the student's weekend.",
            )
        )
        result.expect.no_more_events()

        # 턴 3: 문법 오류가 포함된 학생 발화
        result = await session.run(
            user_input="Yesterday I goed to the park with my friend and we play soccer."
        )
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent=(
                    "Engages with the content (park, soccer) without harshly criticizing grammar. "
                    "Continues the conversation."
                ),
            )
        )
        result.expect.no_more_events()

        # 턴 4: 감정 표현
        result = await session.run(user_input="It was really fun. The weather was very nice.")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent="Acknowledges the student's positive experience and continues the conversation.",
            )
        )
        result.expect.no_more_events()

        # 턴 5: 역질문
        result = await session.run(user_input="What do you usually do on weekends?")
        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                llm_instance,
                intent="Responds to the question and keeps the conversation going.",
            )
        )
        result.expect.no_more_events()
