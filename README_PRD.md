# CSCL TBLT — 프로덕션 운영 가이드

실제 교실 환경(수업) 배포를 기준으로 작성된 운영 문서.
인프라 선택 근거, 부하 분석, 외부 서비스 제약, 알려진 이슈 및 해결책을 기록한다.

---

## 목차

1. [배포 환경 개요](#1-배포-환경-개요)
2. [인스턴스 선택 근거](#2-인스턴스-선택-근거)
3. [부하 분석 — 15세션 기준](#3-부하-분석--15세션-기준)
4. [외부 서비스 제약](#4-외부-서비스-제약)
5. [Agent Worker 내부 구조](#5-agent-worker-내부-구조)
6. [적용된 최적화](#6-적용된-최적화)
7. [알려진 이슈 및 해결책](#7-알려진-이슈-및-해결책)
8. [모니터링 가이드](#8-모니터링-가이드)
9. [향후 과제](#9-향후-과제)

---

## 1. 배포 환경 개요

| 항목 | 값 |
|------|-----|
| 서버 | AWS EC2 **m5.xlarge** (4 vCPU, 16GB RAM) |
| OS | Ubuntu 22.04 LTS |
| 도메인 | `tblt-agent.net` (AWS Route 53 + Elastic IP) |
| Agent 프로세스 관리 | systemd (`cscl-agent.service`) |
| Client 프로세스 관리 | PM2 (`cscl-client`) |
| 리버스 프록시 | nginx + Let's Encrypt SSL |
| 음성 녹음 저장소 | AWS S3 (`tblt-agent-recordings`, `ap-northeast-2`) |
| LiveKit Cloud | Ship 플랜 |
| OpenAI | Usage Tier 4 |

---

## 2. 인스턴스 선택 근거

### 왜 m5.xlarge인가

최초 배포는 **m5.large (2 vCPU, 8GB RAM)** 로 시작했으나, 15세션 동시 운영 시나리오 분석 결과 m5.xlarge로 업그레이드했다.

#### 핵심 병목: Silero VAD (로컬 신경망 추론)

STT/LLM/TTS는 LiveKit Cloud inference에서 처리되어 서버 부하가 없다.
유일한 **로컬 CPU 연산**은 Silero VAD로, 10ms 단위로 음성 구간을 감지하는 신경망 추론이다.

```
세션당 VAD CPU 점유: ~8~12%
15세션 기준: 15 × 10% = 150%
```

| 인스턴스 | vCPU | RAM | 15세션 CPU 여유 | 판정 |
|---|---|---|---|---|
| m5.large | 2 (200%) | 8GB | 150% → 여유 50% | 피크 시 초과 위험 |
| **m5.xlarge** | **4 (400%)** | **16GB** | 150% → 여유 250% | 안정적 |
| c5.xlarge | 4 (400%) | 8GB | CPU 충분, RAM 빠듯 | RAM 리스크 |

#### c5 대신 m5를 선택한 이유

`MultilingualModel`(turn detector)이 세션마다 인스턴스화되고, 각 Worker의 inference subprocess가 ONNX 모델을 로드한다. 실측 전 RAM 여유가 필요하다고 판단해 8GB(c5.xlarge)보다 16GB(m5.xlarge)를 선택했다.

> 실제 확인 결과, ONNX 모델은 Worker 프로세스당 1개의 inference subprocess에서 공유 로드된다.
> `MultilingualModel()` 인스턴스 자체는 경량 래퍼(~수 KB)이므로 세션당 메모리 부담이 없다.
> → 결과적으로 RAM은 충분히 여유롭지만, CPU 안정성을 위해 m5.xlarge 선택은 여전히 유효하다.

#### t3 계열을 쓰지 않는 이유

t3 인스턴스는 CPU 크레딧 기반으로 동작한다. VAD처럼 지속적인 CPU 부하가 걸리면 크레딧이 소진되어 CPU가 기준 성능(베이스라인) 이하로 스로틀링된다. 수업 도중 갑작스러운 응답 지연이 발생할 수 있어 비권장.

---

## 3. 부하 분석 — 15세션 기준

### 시나리오 가정

- 학생 30명 최대 동시 접속
- 그룹 구성: 2~3인 1그룹
- 최대 세션 수: **15개** (2인 1그룹 기준)
- 세션당 참가자: 학생 2~3명 + AI 에이전트 1명

### 계층별 부하

#### LiveKit Cloud (SFU)

관리형 분산 SFU로 EC2 서버 부하 없음. Ship 플랜 기준 동시 연결 1,000명까지 지원.

```
15세션 × 4명(AI 포함) = 최대 60 concurrent participants
→ Ship 플랜 한도(1,000명)의 6% 수준 — 문제 없음
```

#### EC2 Agent Worker (CPU)

```
Silero VAD: 15세션 × ~10% = ~150% / 400% (4 vCPU)
→ m5.xlarge에서 37.5% 점유 — 피크 여유 충분
```

#### EC2 Agent Worker (RAM)

```
Python 프로세스 base:     ~200MB
Silero VAD (공유, 1회):   ~100MB
ONNX inference subprocess: ~300MB (Worker당 1회 공유)
세션 상태 × 15:           ~50~100MB × 15 = ~750MB~1.5GB
────────────────────────────────
합계 추정:                ~1.5~2.1GB / 16GB
→ 안정적
```

#### STT / LLM / TTS

모두 LiveKit Cloud inference(`inference.STT`, `inference.LLM`, `inference.TTS`)를 통해 처리.
EC2 서버에서는 API 호출만 발생하므로 로컬 부하 없음.

---

## 4. 외부 서비스 제약

### LiveKit Cloud — Ship 플랜

| 항목 | 한도 | 15세션 사용량 | 여유 |
|---|---|---|---|
| 동시 에이전트 세션 | **20개** | 최대 15개 | ✅ 여유 5개 |
| 동시 연결 수 | 1,000명 | ~60명 | ✅ 여유 충분 |
| 포함 에이전트 분 | **5,000분/월** | 수업 횟수에 따라 상이 | ⚠️ 모니터링 필요 |
| 에이전트 배포 수 | 2개 | 3개 (`pipeline-agent`, `realtime-dominant-agent`, `realtime-passive-agent`) | 모드/실험 조건별 사용 |
| WebRTC 포함 분 | 150,000분/월 | ~900분/회 × 수업 수 | ✅ 여유 충분 |

#### 에이전트 분 소진 예측

```
15세션 × 수업 1회 30분 = 450분/회
월 10회 수업 → 4,500분 → 한도(5,000분) 근접
월 12회 이상 → 5,400분 → 초과 → 추가 과금 발생
```

> LiveKit Cloud 콘솔(cloud.livekit.io)에서 월별 사용량을 주기적으로 확인할 것.
> 초과 시 다음 플랜(Scale)으로 업그레이드 또는 수업당 세션 시간 단축 검토.

### OpenAI — Usage Tier 4

| 항목 | Tier 4 한도 | 15세션 실제 사용량 | 여유 |
|---|---|---|---|
| RPM (gpt-4.1-mini) | ~10,000 | ~45 RPM | ✅ 한도의 0.5% |
| TPM | ~2,000,000 | ~15,000 TPM | ✅ 한도의 0.75% |

Rate Limit 위험 없음.

---

## 5. Agent Worker 내부 구조

### num_idle_processes 자동 설정

`main.py`에서 `AgentServer()`를 기본값으로 초기화하면, **프로덕션 모드에서 CPU 코어 수만큼 idle process가 자동 생성**된다.

```python
# livekit/agents/worker.py (SDK 내부)
_default_num_idle_processes = ServerEnvOption(
    dev_default=0,
    prod_default=math.ceil(get_cpu_monitor().cpu_count())  # m5.xlarge → 4
)
```

m5.xlarge (4 vCPU) 기준으로 idle process가 4개 자동 생성된다.
**`--num-workers` 같은 CLI 플래그는 존재하지 않으며, 코드에서 명시적으로 설정할 필요 없다.**

명시적 제어가 필요한 경우:
```python
# main.py
server = AgentServer(num_idle_processes=3)  # 명시적 설정
```

### Silero VAD 공유

```python
# main.py — prewarm: JobProcess(Worker)당 1회 실행
def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()  # 프로세스 내 모든 세션이 공유
```

VAD 모델은 Worker 프로세스당 1회 로드되고, 해당 프로세스 내 모든 세션이 공유한다.

### MultilingualModel (Turn Detector)

세션마다 `MultilingualModel()` 인스턴스가 생성되지만, **실제 ONNX 모델은 별도 inference subprocess에서 Worker당 1회만 로드**된다.
각 `MultilingualModel()` 인스턴스는 inference executor에 대한 참조와 언어 설정 JSON만 보유하는 경량 래퍼다.
→ 세션 수가 늘어도 ONNX 모델 메모리는 증가하지 않는다.

---

## 6. 적용된 최적화

### ConversationLogger 비동기 배치 쓰기

**문제**: 기존 구현은 대화 항목이 추가될 때마다 전체 JSON을 동기적으로 재작성했다.
15세션 동시 진행 시 초당 수십 회의 동기 disk write가 이벤트 루프를 블로킹했다.

```python
# 기존 — 매 발화마다 동기 전체 재작성
def log(self, ...):
    self.entries.append(entry)
    self._save()  # ← 이벤트 루프 블로킹
```

**해결**: 1초 디바운스 + 비동기 write로 전환.

```python
# 변경 후 — 1초 내 다수 호출을 단일 disk write로 통합
def log(self, ...):
    self.entries.append(entry)
    self._schedule_flush()  # 비동기 스케줄링

async def _flush_after_delay(self) -> None:
    await asyncio.sleep(1)           # 1초 배치 윈도우
    await asyncio.to_thread(self._flush_sync)  # 비동기 disk write
```

대시보드의 SSE stream consumer(`/api/logs/stream/route.ts`)가 1초 간격으로 polling하므로, 1초 배치 쓰기는 실시간성을 해치지 않는다.

---

## 7. 알려진 이슈 및 해결책

### 이슈 1: `LIVEKIT_URL is not defined` (Client)

**증상**: PM2 로그에 `Error: LIVEKIT_URL is not defined` 반복 출력. 토큰 발급 실패로 학생이 룸에 입장 불가.

**원인**: `/opt/cscl-tblt/client/.env.local` 파일 누락 또는 내용 오류.
Next.js는 `pnpm start`(프로덕션) 실행 시 `.env.local`을 읽어 서버사이드 환경변수를 주입하는데, 파일이 없으면 `undefined`가 된다.

**해결**:
```bash
sudo tee /opt/cscl-tblt/client/.env.local << 'EOF'
LIVEKIT_URL=wss://cscl-t8duxbt1.livekit.cloud
LIVEKIT_API_KEY=<값>
LIVEKIT_API_SECRET=<값>
NEXT_PUBLIC_SERVER_URL=https://tblt-agent.net
EOF

pm2 restart cscl-client
```

### 이슈 2: `Failed to find Server Action` (Client)

**증상**: PM2 로그에 `[Error: Failed to find Server Action "x"]` 출력.

**원인**: 서버가 새 빌드로 재배포된 후, 브라우저가 이전 빌드의 Server Action ID를 캐시하고 있을 때 발생하는 일시적 불일치.

**해결**: 사용자 브라우저 강력 새로고침(`Cmd+Shift+R` / `Ctrl+Shift+R`). 코드 수정 불필요.

### 이슈 3: `static directory deprecated` (Client)

**증상**: PM2 로그에 `⚠ The static directory has been deprecated` 반복 출력.

**원인**: `client/static/` 디렉토리에 Next.js 이전 버전 레거시 HTML 파일 잔존.
Next.js는 현재 `public/`을 정적 파일 디렉토리로 사용하며, `static/`은 deprecated.

**현황**: GitHub Issue [#1](https://github.com/Ridealist/cscl-tblt/issues/1) 등록됨.
기능에는 영향 없음. `client/app/` 내 어디서도 참조되지 않는 dead code.

**해결** (Issue #1 처리 시):
```bash
rm -rf /opt/cscl-tblt/client/static/
cd /opt/cscl-tblt/client && pnpm build
pm2 restart cscl-client
```

### 이슈 4: `metadataBase` 경고 (Client)

**증상**: PM2 로그에 `⚠ metadataBase property in metadata export is not set` 출력.

**원인**: Next.js metadata API 사용 시 `metadataBase` 미설정. OG 이미지 경로 resolve에 `localhost:3000`을 기본값으로 사용한다는 경고.

**영향**: 없음. 이 프로젝트에는 OG 이미지 메타데이터가 없으므로 실질적 문제 없음.

---

## 8. 모니터링 가이드

### 일상 상태 확인

```bash
# Agent 상태
sudo systemctl status cscl-agent
sudo journalctl -u cscl-agent --no-pager | tail -30

# Client 상태
pm2 list
pm2 logs cscl-client --lines 30

# 메모리 사용량 (전체)
free -h

# CPU 사용률 실시간
top -b -n 1 | head -20
```

### 세션 시작 시 정상 로그 패턴

```
# cscl-agent 로그에서 확인해야 할 내용
INFO agent worker started
INFO on_enter — participants: ['Alice', 'Bob']
INFO Egress started: id=... → s3://tblt-agent-recordings/...
INFO Speaker tag injected: [Alice]
```

### 비정상 징후

| 로그 | 의미 | 조치 |
|---|---|---|
| `LIVEKIT_URL is not defined` | `.env.local` 누락 | 이슈 1 참고 |
| `languages.json not found` | Turn Detector 모델 미다운로드 | `uv run python main.py download-files` |
| `Failed to start Egress` | S3 IAM 권한 또는 버킷 오류 | AWS S3 권한 확인 |
| `Restart=always` 반복 재시작 | Agent 크래시 루프 | `journalctl -u cscl-agent -f`로 원인 확인 |

### LiveKit Cloud 사용량 모니터링

월 1회 이상 [cloud.livekit.io](https://cloud.livekit.io) 콘솔에서 **에이전트 분(Agent Minutes)** 소진량 확인.
Ship 플랜 포함 5,000분/월. 월 12회 이상 수업 시 초과 가능.

---

## 9. 향후 과제

| 항목 | 우선순위 | 설명 |
|---|---|---|
| `client/static/` 삭제 | 중간 | Issue #1. deprecated 경고 제거, dead code 정리 |
| LiveKit Cloud 사용량 초과 대응 | 중간 | Scale 플랜 업그레이드 또는 세션 시간 단축 정책 수립 |
| 에이전트 분 알림 설정 | 낮음 | LiveKit 콘솔 또는 별도 모니터링으로 임계값 알림 구성 |
| `metadataBase` 경고 제거 | 낮음 | `client/app/layout.tsx`에 `metadataBase` 1줄 추가 |
