# English Speaking Practice — CSCL TBLT

LiveKit 기반 AI 영어 대화 실습 시스템. TBLT(Task-Based Language Teaching) 방식으로, AI 캐릭터 **Alex**(한국 거주 외국인 초등학생)와 **주말 약속 만들기** 태스크를 수행하는 실시간 음성 대화 에이전트. 대상: 한국어권 대학생.

## 프로젝트 구조

```
CSCL_TBLT/
├── .env                  # API 키 (직접 입력 필요, git 추적 안 됨)
├── .env.example          # 환경변수 템플릿
├── .github/
│   └── workflows/
│       ├── agent-tests.yml            # agent/ 테스트 CI
│       └── client-build-and-test.yaml # client/ 빌드/린트 CI
│
├── agent/                # AI 음성 에이전트 (LiveKit Agents Python SDK)
│   ├── main.py           # 에이전트 진입점 (CLI 지원)
│   ├── prompt.py         # 시스템 프롬프트
│   ├── logger.py         # 대화 JSON 로거
│   ├── pyproject.toml
│   ├── uv.lock
│   └── tests/
│       └── test_conversation.py  # LLM 단독 대화 흐름 테스트
│
├── server/               # 토큰 발급 서버 (FastAPI)
│   ├── main.py           # GET /token, POST /dispatch
│   ├── pyproject.toml
│   └── uv.lock
│
├── client/               # 브라우저 클라이언트
│   ├── static/           # 심플 클라이언트 (HTML/JS) — python -m http.server 전용
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   ├── app/              # Next.js 클라이언트 (고급)
│   └── .env.local        # Next.js용 환경변수 (git 추적 안 됨)
│
└── logs/                 # 대화 로그 JSON (자동 생성, git 추적 안 됨)
```

## 아키텍처

```
브라우저 클라이언트 (client/)
    │
    ├─[GET /token?name=이름]──► 토큰 서버 (server/main.py :8000)
    │                                │
    │                                └─[POST /dispatch]──► LiveKit Cloud
    │                                                           │
    └─[WebRTC 연결]──────────────────────────────────────────────┤
                                                                │
                                                     AI 에이전트 (agent/main.py)
                                                     STT → LLM → TTS
```

- **토큰 서버** (`server/`): 브라우저가 LiveKit에 접속할 JWT 토큰 발급. `/dispatch` 엔드포인트로 에이전트를 room에 수동 호출.
- **AI 에이전트** (`agent/`): LiveKit Cloud에 상시 연결 대기. room에 dispatch되면 STT → LLM → TTS 파이프라인으로 사용자와 대화.
- **클라이언트** (`client/`): 심플 HTML/JS 또는 Next.js 중 선택.

## 사전 준비

### 1. uv 설치 (없는 경우)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. `.env` 작성

```bash
cp .env.example .env
```

`.env` 파일에 값 입력:

```env
# LiveKit Cloud (https://cloud.livekit.io → 프로젝트 생성 후 발급)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# 채팅방 및 에이전트 이름 (변경 시 client/app.js와 일치시킬 것)
ROOM_NAME=english-practice
AGENT_NAME=my-agent

# LiveKit Inference를 사용하지 않을 경우에만 필요
OPENAI_API_KEY=
DEEPGRAM_API_KEY=
```

> LiveKit Cloud의 LiveKit Inference를 사용하면 OPENAI_API_KEY / DEEPGRAM_API_KEY 없이도 STT·LLM·TTS가 동작합니다.

### 3. 에이전트 모델 파일 다운로드 (최초 1회)

```bash
cd agent
uv sync
uv run python main.py download-files
```

## 실행 방법

### 전체 스택 실행 (터미널 3개)

```bash
# 터미널 1 — 토큰 서버
cd server
uv sync
uv run uvicorn main:app --port 8000 --reload
```

```bash
# 터미널 2 — AI 에이전트
cd agent
uv run python main.py dev
```

```bash
# 터미널 3 — 심플 HTML 클라이언트
cd client/static
python -m http.server 3000
```

브라우저에서 http://localhost:3000 접속 → 이름 입력 → 입장 → 🤖 에이전트 생성 버튼 클릭.

---

## CLI 단독 실험 (브라우저/프론트엔드 없이)

에이전트를 터미널에서 직접 실행해 백엔드만 빠르게 실험할 수 있습니다.  
마이크와 스피커만 있으면 되고, 토큰 서버와 클라이언트는 불필요합니다.

```bash
cd agent

# 터미널 음성 대화 모드 (마이크로 말하고 스피커로 듣기)
uv run python main.py console

# 프론트엔드 연결 대기 모드 (토큰 서버·클라이언트와 함께 사용)
uv run python main.py dev

# 프로덕션 모드
uv run python main.py start
```

| 명령 | 설명 | 필요한 것 |
|------|------|----------|
| `console` | 터미널 단독 음성 대화 | 마이크, 스피커 |
| `dev` | 프론트엔드 연결 대기 (자동 재시작) | 토큰 서버, 클라이언트 |
| `start` | 프로덕션 실행 | 토큰 서버, 클라이언트 |
| `download-files` | VAD 등 ML 모델 다운로드 | — |

---

## Next.js 클라이언트 (고급)

`client/`에는 심플 HTML 클라이언트 외에 React/Next.js 기반 고급 클라이언트도 포함되어 있습니다.  
Next.js 클라이언트는 자체 `/api/token` 라우트를 가지므로 **토큰 서버(`server/`)가 필요 없습니다.**

```bash
cd client
pnpm install
pnpm dev          # http://localhost:3000
```

`client/.env.local`에 LiveKit 자격증명이 있는지 확인하세요 (루트 `.env`와 동일한 값).

> **주의:** Next.js 클라이언트의 `/api/token` 라우트는 개발 환경 전용입니다. 프로덕션 배포 시 인증 레이어를 반드시 추가해야 합니다.

---

## 테스트

### 에이전트 LLM 동작 테스트

마이크·브라우저 없이 LLM만 사용해 대화 흐름을 자동 검증합니다.

```bash
cd agent
uv run pytest tests/ -v
```

테스트 내용 (`tests/test_conversation.py`):
- 5턴 대화 흐름 검증 (주말 약속 만들기 태스크)
- 문법 오류 발화에 대한 Alex의 자연스러운 반응 확인
- 역질문(주말 활동)에 대한 응답 확인

---

## 관리자 모니터링

토큰 서버(`server/`)가 실행 중일 때, 브라우저에서 아래 주소에 접속하면 진행 중인 대화를 실시간으로 확인할 수 있습니다.

```
http://localhost:3000/admin.html
```

- 가장 최근 세션의 대화 로그를 1초 단위로 갱신
- 참가자 이름, 발화 시각, 역할(User/Agent) 표시
- 서버 연결이 끊기면 자동 재연결

---

## 대화 로그

대화가 끝나면 `logs/` 폴더에 JSON 파일로 자동 저장됩니다.

```
logs/
└── RM_9GkS7d8BWCsf--260409_14:23.json
```

파일명 형식: `{session_id}_{started_at}.json`

```json
{
  "session_id": "RM_9GkS7d8BWCsf",
  "room": "english-practice",
  "entries": [
    { "timestamp": "2026-04-09T14:23:05", "role": "user",  "text": "Hello!", "participant_identity": "user_1234", "participant_name": "고준보" },
    { "timestamp": "2026-04-09T14:23:07", "role": "agent", "text": "Hi! How are you today?" }
  ]
}
```

---

## 주요 설정

| 항목 | 위치 |
|------|------|
| AI 시스템 프롬프트 수정 | `agent/prompt.py` |
| STT / LLM / TTS 모델 변경 | `agent/main.py` (현재: STT `deepgram/nova-3`, LLM `openai/gpt-4.1-mini`, TTS `cartesia/sonic-3`) |
| 토큰 서버 포트 변경 | `server/main.py` + `client/static/app.js` 상단 `SERVER` 변수 |
| Room 이름 변경 | `.env` → `ROOM_NAME` |
| 에이전트 이름 변경 | `.env` → `AGENT_NAME` (agent/main.py의 `agent_name`과 일치시킬 것) |
| 로그 저장 위치 변경 | `agent/logger.py` → `LOGS_DIR` |
