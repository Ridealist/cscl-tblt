# English Speaking Practice — CSCL TBLT

LiveKit 기반 AI 영어 대화 실습 시스템. TBLT(Task-Based Language Teaching) 방식으로, AI 캐릭터 **Kate**와 과업 기반 영어 대화를 수행하는 실시간 음성 대화 에이전트. 대상: 한국어권 학생.

관리자는 `/admin`에서 수업 운영 모드를 선택할 수 있다.

- **그룹 대화 모드** (`pipeline`): 학생 n명 + 에이전트 1명의 STT → LLM → TTS 파이프라인. 에이전트 이름: `pipeline-agent`
- **개별 대화 모드** (`realtime`): 학생 1명 + 에이전트 1명의 OpenAI Realtime speech-to-speech 파이프라인. 에이전트 이름: `realtime-agent`, role: `dominant` 또는 `collaborative`

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
│   ├── prompt_pipeline.py # 그룹 대화 모드 시스템 프롬프트
│   ├── prompt_realtime.py # 개별 대화 모드 시스템 프롬프트
│   ├── logger.py         # 대화 JSON 로거
│   ├── pyproject.toml
│   ├── uv.lock
│   └── tests/
│       └── test_conversation.py  # LLM 단독 대화 흐름 테스트
│
├── server/               # legacy static 클라이언트용 토큰 발급 서버 (FastAPI)
│   ├── main.py           # GET /token, POST /dispatch
│   ├── pyproject.toml
│   └── uv.lock
│
├── client/               # Next.js 브라우저 클라이언트
│   ├── app/              # Next.js App Router + API routes
│   ├── components/       # 로비, 관리자, LiveKit UI 컴포넌트
│   ├── static/           # legacy 심플 클라이언트 (HTML/JS)
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   └── .env.local        # Next.js용 환경변수 (git 추적 안 됨)
│
├── config.example.json   # 로컬 fallback/import용 운영 설정 예시
├── config.json           # 로컬 fallback 운영 설정 (git 추적 안 됨)
└── logs/                 # 대화 로그 JSON (자동 생성, git 추적 안 됨)
```

## 브랜치 전략

이 저장소는 `main` / `develop` 기준으로 운영한다.

| 브랜치    | 역할                                  | 운영 원칙                                                                         |
| --------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `main`    | 실제 서버 배포와 연결되는 안정 브랜치 | 배포 가능한 상태만 유지한다. 검증된 변경만 병합하고, 미완성 실험은 올리지 않는다. |
| `develop` | 기능 개발과 실험 통합 브랜치          | 새 기능, UI/프롬프트 실험, 검증 전 변경의 기본 합류 지점으로 사용한다.            |

기본 흐름:

- 새 작업은 `develop`에서 `feature/...`, `issue-...`, `experiment/...` 브랜치를 만든다.
- 일반 변경은 작업 브랜치에서 `develop`으로 PR을 열어 합친다.
- 배포할 묶음이 안정화되면 `develop`에서 `main`으로 PR을 열어 합친 뒤 실제 서버에 배포한다.
- 운영 장애나 긴급 수정은 `main`에서 `hotfix/...` 브랜치를 만들고, 배포 후 같은 수정이 `develop`에도 반영되도록 한다.

## 아키텍처

### 현재 기본 구조: Next.js 클라이언트

```
브라우저 클라이언트 (client/ Next.js)
    │
    ├─[GET /api/rooms]──────────────► Supabase app_settings + LiveKit room 조회
    ├─[POST /api/admin/config]──────► Supabase app_settings에 운영 설정 저장
    ├─[POST /api/token]─────────────► LiveKit 참가자 토큰 발급
    │                                  room_config.agents로 agent 자동 배치
    │
    └─[WebRTC 연결]────────────────► LiveKit Cloud
                                      │
                                      ├─ pipeline-agent: STT → LLM → TTS
                                      └─ realtime-agent: OpenAI Realtime
```

- **Next.js 클라이언트** (`client/`): 학생 로비, 관리자 설정, 관리자 대시보드, 토큰 발급 API를 포함한다.
- **AI 에이전트** (`agent/`): 같은 코드에서 `pipeline-agent`, `realtime-agent` worker를 실행한다. Realtime role은 `dominant` 또는 `collaborative`로 선택한다.
- **legacy 토큰 서버** (`server/`): `client/static` HTML 클라이언트용이다. 현재 Next.js 앱 실행에는 필요하지 않다.

### 수업 운영 모드

| 모드       | UX 표시명      | Room 정책                                   | Agent            | 음성 처리                                                                  |
| ---------- | -------------- | ------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `pipeline` | 그룹 대화 모드 | `12반-1그룹` 같은 그룹 room                 | `pipeline-agent` | STT `deepgram/nova-3` → LLM `openai/gpt-4.1-mini` → TTS `cartesia/sonic-3` |
| `realtime` | 개별 대화 모드 | `realtime-{반}-{학생명}-{suffix}` 자동 생성 | `realtime-agent` | OpenAI Realtime speech-to-speech                                           |

## 사전 준비

### 1. uv 설치 (없는 경우)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. `.env` 작성

```bash
cp .env.example .env
cp config.example.json config.json
```

`config.json`은 Supabase가 설정되지 않은 로컬 개발 fallback 및 초기 import 참고용이다. Production 운영 설정은 Supabase `app_settings`에 저장된다.

`.env` 파일에 값 입력:

```env
# LiveKit Cloud (https://cloud.livekit.io → 프로젝트 생성 후 발급)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# 채팅방 및 에이전트 이름
ROOM_NAME=english-practice
AGENT_NAME=pipeline-agent
AGENT_WORKER_MODE=pipeline
AGENT_ROLE=dominant

# Realtime 모드에는 OPENAI_API_KEY가 필요
# Pipeline 모드는 LiveKit Inference를 사용하면 OPENAI_API_KEY / DEEPGRAM_API_KEY 없이도 동작
OPENAI_API_KEY=
DEEPGRAM_API_KEY=
```

> Next.js 앱의 운영 모드는 `.env`가 아니라 Supabase `app_settings.agent_mode`로 결정되며, `/admin`에서 변경한다. Supabase가 없는 로컬 개발 환경에서는 `config.json` fallback을 사용할 수 있다. Realtime 상호작용 role은 관리자 전용 `agentRole` 설정으로만 노출된다.

### 3. 에이전트 모델 파일 다운로드 (최초 1회)

```bash
cd agent
uv sync
uv run python main.py download-files
```

## 실행 방법

### 현재 Next.js 앱 실행

최초 1회 의존성을 설치한다.

```bash
pnpm setup
```

루트에서 다음 명령 하나로 agent worker와 Next.js 클라이언트를 함께 실행한다. `pnpm dev`의 auto 모드는 로컬 프로세스 선택을 위해 `config.json`의 `agentMode`/`agentRole`을 읽는다. 앱 route의 런타임 운영 설정은 Supabase `app_settings`를 사용하며, Supabase가 없는 로컬 fallback 환경에서는 `config.json` 값을 사용한다.

```bash
pnpm dev
```

브라우저에서:

- 학생 로비: http://localhost:3000
- 관리자 설정: http://localhost:3000/admin
- 관리자 대시보드: http://localhost:3000/admin/dashboard

> Next.js 클라이언트는 자체 `/api/token` 라우트를 가지므로 `server/` FastAPI 토큰 서버가 필요 없다.

개별 대화 모드 worker로 실행하려면 다음 명령을 사용한다.

```bash
pnpm dev:realtime
```

collaborative 조건으로 실행하려면 다음 명령을 사용한다.

```bash
pnpm dev:realtime:collaborative
```

pipeline, realtime dominant, realtime collaborative worker를 모두 함께 띄우려면 다음 명령을 사용한다.

```bash
pnpm dev:all
```

`/admin`에서 개별 대화 모드와 상호작용 방식을 선택하면 학생은 조건명을 보지 않고 개별 room으로 입장한다.

기존처럼 터미널을 나눠 실행해야 할 때는 다음 개별 명령을 사용할 수 있다.

```bash
pnpm dev:agent:pipeline
pnpm dev:client
```

### legacy static 클라이언트 실행 (선택)

`client/static`을 사용할 때만 FastAPI 토큰 서버가 필요하다.

```bash
# 터미널 1 — legacy 토큰 서버
cd server
uv sync
uv run python -m uvicorn main:app --port 8000 --reload
```

```bash
# 터미널 2 — pipeline-agent
cd agent
AGENT_WORKER_MODE=pipeline uv run python main.py dev
```

```bash
# 터미널 3 — static HTML 클라이언트
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

| 명령             | 설명                               | 필요한 것          |
| ---------------- | ---------------------------------- | ------------------ |
| `console`        | 터미널 단독 음성 대화              | 마이크, 스피커     |
| `dev`            | 프론트엔드 연결 대기 (자동 재시작) | Next.js 클라이언트 |
| `start`          | 프로덕션 실행                      | Next.js 클라이언트 |
| `download-files` | VAD 등 ML 모델 다운로드            | —                  |

---

## Next.js 클라이언트

`client/.env.local`에 LiveKit 자격증명이 필요하다.

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Supabase admin auth / persistent state migration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

Next.js API routes:

| Route                                   | 역할                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| `POST /api/token`                       | 참가자 토큰 발급, 현재 운영 모드에 맞는 agent 자동 배치 |
| `GET /api/rooms`                        | 활성 반의 그룹 room과 realtime 개별 room 현황 조회      |
| `GET/POST /api/admin/config`            | Supabase `app_settings` 읽기/쓰기                       |
| `GET/POST /api/dispatch`                | 그룹 대화 모드에서 `pipeline-agent` 수동 배치/존재 확인 |
| `POST /api/rooms/terminate`             | room 강제 종료                                          |
| `GET /api/logs`, `GET /api/logs/stream` | 대화 로그 목록/스트리밍                                 |

> **주의:** Production에서 `/admin`, `/api/admin`, 관리자성 API(`/api/dispatch`, `/api/logs`, `/api/rooms/terminate`)는
> Supabase Auth session과 `profiles.role = 'admin'` 권한으로 보호된다.
> `ADMIN_USERNAME`/`ADMIN_PASSWORD` Basic Auth는 더 이상 사용하지 않는다.

### Supabase runtime storage

Supabase 도입은 GitHub issue #4의 단계별 작업으로 진행한다. 현재 admin auth와 수업 운영 설정은 Supabase를 사용한다.

- `client/lib/supabase/client.ts`: browser/client component용 Supabase client
- `client/lib/supabase/server.ts`: server component, route handler, server action용 cookie-aware client
- `client/lib/supabase/admin.ts`: 서버 전용 secret-key client
- `client/lib/supabase/proxy.ts`: Auth session refresh와 admin route guard용 proxy/middleware helper
- `client/lib/settings-store.ts`: `app_settings` 기반 운영 설정 store와 local fallback adapter
- `supabase/config.toml`: 로컬 Supabase CLI 실행 포트와 migration 설정
- `supabase/migrations/20260611000000_foundation.sql`: 초기 schema와 RLS policy
- `supabase/migrations/20260612000000_realtime_prompt_version_rpc.sql`: active prompt version 교체 RPC

초기 schema는 다음 테이블을 만든다.

| Table                      | 역할                                          |
| -------------------------- | --------------------------------------------- |
| `profiles`                 | Supabase Auth 사용자별 앱 권한 및 표시명      |
| `app_settings`             | 수업 운영 설정 저장소                         |
| `realtime_prompt_versions` | Realtime prompt override version 저장소       |

최초 admin은 Supabase Auth 사용자 생성 후 SQL 또는 dashboard에서 `profiles.role = 'admin'`으로 부여한다.

```sql
insert into public.profiles (user_id, role, display_name)
values ('<auth-user-id>', 'admin', 'Admin')
on conflict (user_id) do update
set role = 'admin',
    display_name = excluded.display_name;
```

`SUPABASE_SECRET_KEY`는 RLS를 우회할 수 있으므로 server-only 코드에서만 사용한다. Next.js API routes는 `client/.env.local`에서 이 값을 읽고, Python realtime agent는 root `.env`에서 같은 URL/secret을 읽어 `promptVersionId`에 해당하는 `realtime_prompt_versions` row를 가져온다.

관리자 로그인 화면은 `/admin/login`이다. 로그인은 Supabase email/password 계정을 사용하며, 계정의 `profiles.role`이 `admin`이어야 `/admin` 및 관리자성 API를 사용할 수 있다.

기존 `config.json` 값을 Supabase로 옮길 때는 다음 형태로 `app_settings` 기본 row를 seed한다.

```sql
insert into public.app_settings (
  id,
  num_classes,
  num_groups_per_class,
  class_start,
  active_class,
  agent_mode,
  agent_role,
  feedback_condition_id,
  realtime_resetting
)
values (
  'default',
  4,
  12,
  9,
  9,
  'realtime',
  'collaborative',
  'explicit_correction',
  false
)
on conflict (id) do update
set num_classes = excluded.num_classes,
    num_groups_per_class = excluded.num_groups_per_class,
    class_start = excluded.class_start,
    active_class = excluded.active_class,
    agent_mode = excluded.agent_mode,
    agent_role = excluded.agent_role,
    feedback_condition_id = excluded.feedback_condition_id,
    realtime_resetting = excluded.realtime_resetting;
```

Production에서는 `client/.env.local`과 root `.env`에 Supabase 연결값이 필요하다. Next.js에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`가 필요하고, Python realtime agent에는 `NEXT_PUBLIC_SUPABASE_URL` 또는 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`가 필요하다. Supabase가 미설정이거나 DB 장애가 있으면 운영 설정 route는 setup/runtime error를 반환한다. 로컬 개발에서는 Supabase가 없거나 일시적으로 실패할 때 `config.json` fallback을 사용한다.

기존 `prompt_config.json` override는 `supabase/README.md`의 `realtime_prompt_versions Migration` 절차로 한 번만 active version row로 이관한다. 이관 후 Realtime custom prompt source of truth는 Supabase prompt version row다. `/api/token`은 active row의 `promptVersionId`를 LiveKit metadata에 넣고, Python realtime agent는 그 id로 같은 row를 fetch한다. `promptVersionId`가 없는 default session은 tracked markdown prompt를 사용한다.

로컬 Supabase CLI는 기존 프로젝트와 기본 포트가 충돌하지 않도록 `5532x` 대역을 사용한다.

```bash
supabase start
supabase db reset --no-seed
supabase status
```

`client/.env.local`에서 로컬 Supabase를 사용할 때는 `supabase status` 출력의 key를 넣는다.

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key-from-supabase-status>
SUPABASE_SECRET_KEY=<secret-key-from-supabase-status>
```

Studio는 `http://127.0.0.1:55323`, Postgres는 `postgresql://postgres:postgres@127.0.0.1:55322/postgres`에서 열린다.

## 관리자 설정

`/admin`에서 다음 값을 관리한다.

| 설정              | 저장 위치                           | 설명                              |
| ----------------- | ----------------------------------- | --------------------------------- |
| 수업 운영 모드    | `app_settings.agent_mode`           | `pipeline` 또는 `realtime`        |
| 현재 수업 중인 반 | `app_settings.active_class`         | 학생 로비에 표시되는 반           |
| 반 번호 시작      | `app_settings.class_start`          | 반 번호 범위의 시작               |
| 전체 학급 수      | `app_settings.num_classes`          | 관리자 화면에 표시할 반 개수      |
| 반당 그룹 수      | `app_settings.num_groups_per_class` | 그룹 대화 모드에서 표시할 그룹 수 |

예시:

```json
{
  "numClasses": 4,
  "numGroupsPerClass": 12,
  "classStart": 9,
  "activeClass": 12,
  "agentMode": "pipeline"
}
```

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
- 문법 오류 발화에 대한 Kate의 자연스러운 반응 확인
- 역질문(주말 활동)에 대한 응답 확인

---

## 관리자 모니터링

Next.js 클라이언트가 실행 중일 때 브라우저에서 아래 주소에 접속하면 세션 로그를 확인할 수 있습니다.

```
http://localhost:3000/admin/dashboard
```

- 저장된 세션 목록 확인
- 세션별 대화 로그 확인
- 참가자 이름, 발화 시각, 역할(User/Agent) 표시

legacy static 클라이언트를 사용할 때는 `client/static/admin.html`을 사용할 수 있다.

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
    {
      "timestamp": "2026-04-09T14:23:05",
      "role": "user",
      "text": "Hello!",
      "participant_identity": "user_1234",
      "participant_name": "고준보"
    },
    {
      "timestamp": "2026-04-09T14:23:07",
      "role": "agent",
      "text": "Hi! How are you today?"
    }
  ]
}
```

---

## 주요 설정

| 항목                             | 위치                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Realtime AI 시스템 프롬프트 수정 | 기본값은 `prompts/realtime/*.md`, 런타임 수정은 `/admin`에서 Supabase `realtime_prompt_versions`로 저장 |
| 기본 AI 시스템 프롬프트 fallback | 그룹 대화는 `agent/prompt_pipeline.py`, 개별 대화는 `prompts/realtime/*.md`                          |
| 그룹 대화 모드 모델 변경         | `agent/main.py` (STT `deepgram/nova-3`, LLM `openai/gpt-4.1-mini`, TTS `cartesia/sonic-3`)           |
| 개별 대화 모드 모델 변경         | `agent/main.py` (`openai.realtime.RealtimeModel`)                                                    |
| 실행할 worker 모드               | `AGENT_WORKER_MODE=pipeline` 또는 `AGENT_WORKER_MODE=realtime` + `AGENT_ROLE=dominant/collaborative` |
| 수업 운영 모드 변경              | `/admin` 또는 Supabase `app_settings.agent_mode`                                                     |
| Realtime 상호작용 role 변경      | `/admin` 또는 Supabase `app_settings.agent_role`                                                     |
| 토큰 서버 포트 변경              | `server/main.py` + `client/static/app.js` 상단 `SERVER` 변수                                         |
| legacy static Room 이름 변경     | `.env` → `ROOM_NAME`                                                                                 |
| 에이전트 이름 변경               | `agent/main.py`, `client/lib/agent-role.ts` (`pipeline-agent`, `realtime-agent`)                     |
| 로그 저장 위치 변경              | `agent/logger.py` → `LOGS_DIR`                                                                       |

Realtime 기본 프롬프트를 수정할 때는 `prompts/realtime/` 아래의 문서형 프롬프트를 수정합니다. agent와 admin 기본값은 이 md 파일들을 직접 읽습니다.

```bash
pnpm prompts:check
```

원본 파일은 `base.md`, `roles/dominant.md`, `roles/collaborative.md`, `task-cards/*.md`입니다. `task-cards/manifest.json`에 등록된 주제별 task card 중 `/admin`에서 선택한 항목이 개별 Realtime 세션에 적용됩니다. `pnpm prompts:check`는 파일 누락이나 빈 파일 같은 기본 오류를 검사합니다.

`/admin`에서 프롬프트를 저장하면 Supabase `realtime_prompt_versions`에 새 version row가 생성되고 해당 row만 active가 됩니다. active custom version은 `prompts/realtime/*.md` 기본값보다 우선하며, base/role prompt와 함께 `feedbackPrompt`, `feedbackConditionId`, `taskCardId`, `taskCardPrompt` snapshot을 보존합니다. md 기본값을 다시 쓰려면 `/admin`에서 "기본값으로 복원"을 실행해 active custom version을 비활성화합니다.

단일 문서에서 복사한 프롬프트를 한 파일로 검사기에 넘길 수도 있습니다. 이 경우 검사기는 `# BASE PROMPT:`, `# INTERLOCUTOR ROLE PROMPT: Dominant`, `# INTERLOCUTOR ROLE PROMPT: Collaborative`, `# TASK CARD:` 헤딩을 기준으로 네 구간을 나눕니다.

`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm dev:agent:*`, 프로덕션 배포 스크립트는 실행 전에 `prompts:check`와 같은 검사를 수행합니다.

---

## 프로덕션 배포 (AWS EC2)

### 현재 배포 환경

| 항목                 | 값                                                 |
| -------------------- | -------------------------------------------------- |
| 서버                 | AWS EC2 `m5.large` (2 vCPU, 8GB RAM)               |
| OS                   | Ubuntu 22.04 LTS                                   |
| 도메인               | `tblt-agent.net` (AWS Route 53)                    |
| 서버 IP              | `3.35.234.204`                                     |
| 프로젝트 경로        | `/opt/cscl-tblt/`                                  |
| Agent 프로세스 관리  | systemd (`cscl-agent.service`)                     |
| Client 프로세스 관리 | PM2 (`cscl-client`)                                |
| 리버스 프록시        | nginx + Let's Encrypt SSL                          |
| 음성 녹음 저장소     | AWS S3 (`tblt-agent-recordings`, `ap-northeast-2`) |

### 서버 디렉토리 구조

```
/opt/cscl-tblt/
├── .env                  # Agent 환경변수 (EnvironmentFile)
├── config.json           # 로컬 fallback/import용 운영 설정
├── logs/                 # 대화 로그 JSON (자동 생성)
├── agent/                # Python Agent
│   └── .venv/            # uv로 생성된 가상환경
└── client/               # Next.js 클라이언트
    └── .env.local        # Next.js 환경변수
```

> `logs/`는 agent 로컬 파일 출력이다. Realtime custom prompt는 Next.js admin/token 경로와 Python realtime agent 모두 Supabase `realtime_prompt_versions`를 사용한다. legacy `prompt_config.json`은 migration 참고용이며 runtime source로 사용하지 않는다.
> 운영 설정은 Supabase `app_settings`를 사용하며, Supabase가 없는 로컬 개발 환경에서만 `config.json` fallback을 사용한다.

기존 EC2 production 서버에 Supabase를 적용하는 절차는 [Production Supabase Runbook](docs/production-supabase-runbook.md)을 따른다.

---

### 최초 서버 세팅 절차

#### 1. 패키지 설치

```bash
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y python3.11 python3.11-venv python3-pip git nginx

curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm pm2
```

#### 2. 코드 업로드

```bash
# GitHub 사용 시
cd /opt
sudo git clone <repo_url> cscl-tblt
sudo chown -R ubuntu:ubuntu cscl-tblt

# 로컬에서 직접 전송 시 (로컬 터미널에서 실행)
scp -i your-key.pem -r /path/to/CSCL_TBLT ubuntu@<서버_IP>:/opt/cscl-tblt
```

#### 3. 환경변수 설정

**`/opt/cscl-tblt/.env`** (Agent용):

```env
LIVEKIT_URL=wss://cscl-t8duxbt1.livekit.cloud
LIVEKIT_API_KEY=<값>
LIVEKIT_API_SECRET=<값>
OPENAI_API_KEY=<값>

S3_BUCKET=tblt-agent-recordings
S3_REGION=ap-northeast-2
AWS_ACCESS_KEY=<값>
AWS_SECRET_ACCESS_KEY=<값>
S3_ENDPOINT=
```

**`/opt/cscl-tblt/client/.env.local`** (Next.js용):

```env
LIVEKIT_URL=wss://cscl-t8duxbt1.livekit.cloud
LIVEKIT_API_KEY=<값>
LIVEKIT_API_SECRET=<값>
NEXT_PUBLIC_SUPABASE_URL=<Supabase Project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
SUPABASE_SECRET_KEY=<Supabase secret key>
STUDENT_SESSION_SECRET=<long random server-only secret>
CONVERSATION_LOG_FILE_FALLBACK=false
```

Python realtime agent도 custom prompt version fetch를 위해 root **`/opt/cscl-tblt/.env`**에 Supabase URL과 secret을 읽을 수 있어야 한다. `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY`를 같은 값으로 두거나, agent 전용으로 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`를 둘 수 있다.

> `S3_ENDPOINT`는 AWS S3 사용 시 반드시 비워두어야 합니다. 값을 넣으면 Egress 업로드 실패.
> Cloudflare R2 등 S3 호환 스토리지 사용 시에만 `https://...` 형식으로 입력.

#### 4. app_settings 초기값 확인

```bash
cp /opt/cscl-tblt/config.example.json /opt/cscl-tblt/config.json
```

`config.json`은 로컬 fallback 및 import 참고용이다. Production에서는 Supabase `app_settings(id = 'default')` row가 운영 설정의 source of truth다. 반/그룹 수와 수업 운영 모드 변경은 `https://tblt-agent.net/admin` 페이지에서 수행한다.

#### 5. Turn Detector 모델 다운로드 (최초 1회 필수)

```bash
cd /opt/cscl-tblt/agent
uv sync
uv run python main.py download-files
```

> 이 단계를 건너뛰면 세션 시작 시 `languages.json not found` 에러로 Agent가 즉시 종료됩니다.

#### 6. Agent systemd 서비스 등록

```bash
sudo tee /etc/systemd/system/cscl-agent-pipeline.service << 'EOF'
[Unit]
Description=CSCL TBLT Pipeline Agent
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/cscl-tblt/agent
ExecStart=/home/ubuntu/.local/bin/uv run python main.py start
Restart=always
RestartSec=5
EnvironmentFile=/opt/cscl-tblt/.env
Environment=AGENT_WORKER_MODE=pipeline

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/cscl-agent-realtime.service << 'EOF'
[Unit]
Description=CSCL TBLT Realtime Agent
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/cscl-tblt/agent
ExecStart=/home/ubuntu/.local/bin/uv run python main.py start
Restart=always
RestartSec=5
EnvironmentFile=/opt/cscl-tblt/.env
Environment=AGENT_WORKER_MODE=realtime

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cscl-agent-pipeline cscl-agent-realtime
sudo systemctl start cscl-agent-pipeline cscl-agent-realtime
```

상태 확인:

```bash
sudo systemctl status cscl-agent-pipeline
sudo systemctl status cscl-agent-realtime
```

로그 확인:

```bash
sudo journalctl -u cscl-agent-pipeline -f
sudo journalctl -u cscl-agent-realtime -f
```

#### 7. Client 빌드 및 PM2 실행

```bash
cd /opt/cscl-tblt/client
pnpm install
pnpm build
pm2 start "pnpm start" --name cscl-client --cwd /opt/cscl-tblt/client
pm2 save
pm2 startup  # 출력된 명령어를 복사해서 실행
```

#### 8. nginx + SSL 설정

```bash
# Let's Encrypt 인증서 발급 (도메인 DNS A 레코드가 서버 IP를 가리키고 있어야 함)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tblt-agent.net

# nginx 설정 (certbot 실행 후 수동으로 확인/교체)
sudo tee /etc/nginx/sites-available/cscl << 'EOF'
server {
    listen 80;
    server_name tblt-agent.net;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name tblt-agent.net;

    ssl_certificate /etc/letsencrypt/live/tblt-agent.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tblt-agent.net/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/cscl /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # 기본 페이지 비활성화
sudo nginx -t && sudo systemctl restart nginx
```

> EC2 보안 그룹 인바운드 규칙에 포트 80(HTTP), 443(HTTPS), 22(SSH)가 열려있어야 합니다.

---

### 코드 업데이트 배포 절차

```bash
cd /opt/cscl-tblt

# 코드 pull (GitHub 사용 시)
git pull

# Agent 의존성이 바뀐 경우 반영
cd agent
uv sync

# Agent 재시작
sudo systemctl restart cscl-agent-pipeline cscl-agent-realtime

  ## 정상 재시작 확인 (에러 없이 "active (running)" 이어야 함)
  sudo systemctl status cscl-agent-pipeline
  sudo systemctl status cscl-agent-realtime

# Client 재빌드 및 재시작
cd /opt/cscl-tblt/client
pnpm install
pnpm build # 빌드 완료까지 1~2분 소요
pm2 restart cscl-client

  ## 빌드 중 오류가 나면:
  # 빌드 로그 확인
  pnpm build 2>&1 | tail -30

  # 재시작 후 PM2 로그 확인
  pm2 logs cscl-client --lines 30

```

---

## CI/CD 파이프라인

GitHub Actions는 세 종류로 구성한다.

| Workflow            | Trigger                                | 역할                                  |
| ------------------- | -------------------------------------- | ------------------------------------- |
| `pre-commit`        | PR/push → `main`, `develop`, 수동 실행 | 공통 파일 형식 및 repo guardrail 검사 |
| `CI`                | PR → `main`, `develop`, 수동 실행      | Client lint/format/build, Agent tests |
| `Deploy Production` | `main` push 또는 수동 실행             | 검증 후 EC2 production 배포           |

Production 배포는 GitHub Actions가 SSH로 EC2에 접속해 `scripts/deploy-production.sh`를 실행한다.

필요한 GitHub Environment/Secrets:

| 이름            | 종류                 | 설명                                    |
| --------------- | -------------------- | --------------------------------------- |
| `PROD_SSH_HOST` | Secret               | EC2 host 또는 IP                        |
| `PROD_SSH_USER` | Secret               | 배포 SSH 사용자, 예: `ubuntu`           |
| `PROD_SSH_KEY`  | Secret               | 배포용 private key                      |
| `PROD_SSH_PORT` | Secret               | SSH port, 기본값 `22`                   |
| `PROD_APP_DIR`  | Environment variable | 서버 repo 경로, 기본값 `/opt/cscl-tblt` |

서버 조건:

- `/opt/cscl-tblt`가 Git checkout이어야 한다.
- 배포 사용자가 `systemctl restart/is-active cscl-agent-pipeline cscl-agent-realtime`를 password 없이 실행할 수 있어야 한다.
- `pnpm`, `uv`, `pm2`, `curl`이 설치되어 있어야 한다.
- 서버의 `.env`, `client/.env.local`, `config.json`, `prompt_config.json`은 배포 중 백업 후 복원된다.
- `config.json`은 git 추적 대상이 아니며, Supabase가 없는 로컬 fallback/import 용도로만 사용한다.
- Production에서는 `client/.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`가 있어야 한다. Realtime custom prompt를 쓰는 agent host의 root `.env`에도 Supabase URL과 server-only secret이 있어야 한다.
- Production 운영 설정은 Supabase `app_settings(id = 'default')` row에 저장된다.
- 최초 admin 계정은 Supabase Auth 사용자 생성 후 `profiles.role = 'admin'`으로 bootstrap해야 한다.

배포 후 health check:

- `cscl-agent-pipeline` active 확인
- `cscl-agent-realtime` active 확인
- `cscl-client` PM2 process 확인 및 재시작
- `http://localhost:3000/api/health` 응답 확인

`main`에 merge되면 배포가 바로 실행되므로, GitHub branch protection에서 `pre-commit`, `CI / Client`, `CI / Agent`를 required check로 설정한다.

---

### 서비스 상태 확인

```bash
# Agent 상태
sudo systemctl status cscl-agent-pipeline
sudo systemctl status cscl-agent-realtime
sudo journalctl -u cscl-agent-pipeline --no-pager | tail -30
sudo journalctl -u cscl-agent-realtime --no-pager | tail -30

# Client 상태
pm2 list
pm2 logs cscl-client --lines 30

# nginx 상태
sudo systemctl status nginx
sudo nginx -t
```

---

### 현재 구현 메모

| 항목                        | 내용                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------- |
| 운영 모드 저장              | Supabase `app_settings.agent_mode`에 `pipeline` 또는 `realtime` 저장               |
| Realtime 상호작용 role 저장 | Supabase `app_settings.agent_role`에 `dominant` 또는 `collaborative` 저장          |
| Agent entrypoint            | `agent/main.py`에 `pipeline-agent`, `realtime-agent` 등록                          |
| 프롬프트 분리               | 그룹 대화는 `agent/prompt_pipeline.py`, 개별 대화 기본값은 `prompts/realtime/*.md` |
| Realtime 의존성             | `livekit-agents[openai,silero,turn-detector]~=1.5`                                 |
| Egress 업로드               | `S3_ENDPOINT` 값이 `http`로 시작하는 경우만 endpoint로 사용                        |

---

### 음성 녹음 (Egress)

세션 시작 시 자동으로 LiveKit Egress API가 호출되어 모든 참가자(학생 + AI) 음성이 혼합된 MP3 파일이 S3에 저장됩니다.

- **저장 경로**: `s3://tblt-agent-recordings/recordings/{룸명}--{타임스탬프}.mp3`
- **트리거**: `session.start()` 직후 자동 시작
- **종료**: 룸 `disconnected` 이벤트 발생 시 자동 종료
- **관련 코드**: `agent/egress_recorder.py`

> Egress는 LiveKit Cloud 인프라에서 실행되므로 서버 부하 없음.
> 단, S3 버킷 및 IAM 권한(`s3:PutObject`) 설정이 되어 있어야 함.

---

### 부하 및 사양 참고

- 그룹 대화 모드 기준: **동시 30명 = 약 15개 Agent 세션** (2인 1그룹)
- 그룹 대화 모드 병목: Silero VAD (10ms 단위 로컬 신경망 추론, 세션당 ~8~12% CPU)
- 그룹 대화 모드 STT/LLM/TTS: LiveKit Cloud inference에서 처리
- 개별 대화 모드: 학생 1명당 realtime Agent 세션 1개
- 개별 대화 모드에는 OpenAI Realtime 사용량과 동시 세션 한도 확인 필요
- `m5.large` (8GB RAM)으로 15세션 안정 운영 확인
- t3 계열은 지속 부하 시 CPU 크레딧 소진으로 스로틀링 발생 — 비권장
