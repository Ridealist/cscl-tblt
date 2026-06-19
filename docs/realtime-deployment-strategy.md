# Realtime Deployment Strategy

> Status: superseded/reference.
> 현재 production 기준값은 [Production Environment](operations/production-environment.md), 배포 절차는 [Deployment Runbook](operations/deployment-runbook.md), 용량 기준은 [Capacity Plan](operations/capacity-plan.md)을 따른다.

이 문서는 2026년 7월까지 **Realtime-only** 운영을 전제로 한 EC2/LiveKit 배포 전략 요약이다.

## 전제

- 7월까지 그룹 대화 `pipeline` 대신 개별 대화 `realtime`만 사용한다.
- 학생 24~25명이 동시에 접속하면 24~25개의 LiveKit room과 `realtime-agent` job이 생성된다.
- LiveKit 플랜은 Scale로 업그레이드되어 있다고 가정한다.
- Supabase는 production source of truth로 사용한다.

## 현재 병목 해석

기존 archive 문서 [Legacy Pipeline Production Guide](archive/2026-legacy-pipeline-production-guide.md)의 핵심 병목 분석은 그룹 대화 `pipeline` 기준이다. `pipeline`은 로컬 Silero VAD와 turn detector를 쓰기 때문에 EC2 CPU 분석이 중요하다.

반면 현재 운영할 `realtime`은 `openai.realtime.RealtimeModel(...)` + Cartesia TTS 기반이다. 따라서 24~25 Realtime 세션의 주요 리스크는 다음 순서로 보는 것이 맞다.

1. 단일 `realtime-agent` worker가 24~25개 job을 동시에 받아들이는 burst 처리
2. OpenAI Realtime API의 프로젝트/모델별 rate limit 및 audio minutes per minute 제한
3. Realtime room 증가에 따른 `/api/rooms` polling 비용
4. EC2 RAM/CPU 여유
5. Supabase 읽기/쓰기 지연

LiveKit Scale 플랜에서는 24~25세션 자체가 LiveKit 플랜 한도에 걸릴 가능성은 낮다. 다만 OpenAI Realtime 한도는 LiveKit 플랜과 별개로 확인해야 한다.

## 1. 실험용 고성능 배포

목표: 수업/실험 시간에 24~25명의 학생이 동시에 Realtime 세션에 안정적으로 들어오는 것.

권장 구성:

| 항목 | 권장값 |
|---|---|
| EC2 | `m5.2xlarge` 최소 |
| vCPU/RAM | 8 vCPU / 32 GiB |
| LiveKit | Scale |
| Agent | `realtime-agent` only |
| Pipeline worker | 중지 권장 |
| Realtime warm process | 24~32개 명시 권장 |

`m5.xlarge`에서 `m5.2xlarge`로 올리는 것은 타당하다. 이유는 평균 CPU뿐 아니라 LiveKit Agents worker의 warm process 여유가 커지기 때문이다. 현재 앱은 `AgentServer()` 기본값을 사용하고, production에서는 CPU count 기반 idle process가 만들어진다. 즉 `m5.xlarge`는 대략 4개, `m5.2xlarge`는 대략 8개의 warm process에서 시작한다.

다만 25명이 거의 동시에 입장하는 실험에서는 8개도 충분히 보수적인 값은 아니다. 실험 안정성을 높이려면 `num_idle_processes`를 환경변수로 설정 가능하게 만들고, 실험용 서버에서는 24~32로 올리는 편이 좋다.

추가 권장 사항:

- `/api/rooms`는 Realtime 모드에서 active room별 `listParticipants()` 호출을 줄인다.
- 실험 전 OpenAI limits dashboard에서 `gpt-realtime` 관련 limit을 확인한다.
- 실험 전 `cscl-agent-realtime`, `cscl-client`, `/api/health`, Supabase `app_settings`를 확인한다.
- 실험 중에는 PM2 로그, `cscl-agent-realtime` journal, LiveKit dashboard, OpenAI usage를 같이 본다.

## 2. 연구자용 저비용 상시 배포

목표: 연구자 3명이 프롬프트 최적화, 관리자 화면, 소수 Realtime 테스트를 평소에 사용할 수 있게 유지하는 것.

권장 구성:

| 항목 | 권장값 |
|---|---|
| EC2 최소안 | `t3.medium` |
| 안정 우선안 | `t3.large` 또는 `m5.large` |
| LiveKit | Ship 또는 필요한 최소 플랜 |
| Agent | `realtime-agent` only |
| Pipeline worker | 중지 권장 |
| Realtime warm process | 2~4개 |

`t3.medium`은 3명 연구자 사용에는 비용 효율적이다. 다만 T3는 CPU credit 기반이므로 장시간 고부하 실험에는 맞지 않는다. 서버에서 `pnpm build`와 `uv sync`까지 직접 수행하므로, 배포 중 메모리 여유를 더 원하면 `t3.large`가 더 안전하다.

평소 서버에서는 24~25명 동시 실험을 수행하지 않는다. 실험일에만 고성능 인스턴스로 변경하는 방식이 비용상 합리적이다.

## 인스턴스 타입 전환 호환성

`m5.2xlarge` / `m5.xlarge` / `t3.medium`은 모두 x86_64 계열 EC2이므로, 현재와 같은 EBS-backed Ubuntu 서버에서는 일반적으로 다음 방식의 전환이 가능하다.

```text
instance stop -> instance type 변경 -> instance start
```

호환성 체크:

| 항목 | 판단 |
|---|---|
| CPU architecture | 모두 x86_64 계열이라 호환 가능 |
| Root volume | EBS-backed이면 유지 |
| `/opt/cscl-tblt` | EBS에 남으므로 유지 |
| `.env`, `client/.env.local` | EBS에 남으므로 유지 |
| 로그 파일 | EBS에 남으므로 유지 |
| Public IP | Elastic IP가 아니면 stop/start 후 바뀔 수 있음 |
| systemd/PM2 | boot 후 자동 복구 설정 확인 필요 |

주의할 점은 인스턴스 타입 변경 자체보다 **운영 설정의 가변화**다. 실험용 `m5.2xlarge`에서 warm process를 24~32로 올린 상태로 `t3.medium`에 내리면 메모리와 CPU credit을 불필요하게 소모할 수 있다. 따라서 warm process 수는 환경변수로 두고 서버 타입에 따라 바꾸는 것이 안전하다.

권장 전환 절차:

1. 평소: `t3.medium` 또는 `t3.large`로 운영
2. 실험 전: instance stop
3. `m5.2xlarge`로 instance type 변경
4. instance start
5. Realtime용 warm process 값을 실험용으로 상향
6. `cscl-agent-realtime`, `cscl-client`, `/api/health` 확인
7. 실험 후: warm process 값을 평소용으로 낮춤
8. instance stop 후 `t3.medium` 또는 `t3.large`로 변경

## 문서 갱신 필요 사항

이 문서는 Realtime-only 실험 검토 기록으로 보관한다. 현재 운영 문서는 다음 위치를 따른다.

- 현재 production 기준값: [Production Environment](operations/production-environment.md)
- 배포 절차: [Deployment Runbook](operations/deployment-runbook.md)
- 평상시/실험일 용량 기준: [Capacity Plan](operations/capacity-plan.md)

## 참고 링크

- AWS EC2 M5 instances: https://aws.amazon.com/ec2/instance-types/m5/
- AWS EC2 T3 instances: https://aws.amazon.com/ec2/instance-types/t3/
- AWS instance type 변경: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-resize.html
- LiveKit pricing: https://livekit.com/pricing
- OpenAI rate limits: https://developers.openai.com/api/docs/guides/rate-limits
