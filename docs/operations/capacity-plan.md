# Capacity Plan

Status: current
Last verified: 2026-06-19

이 문서는 평상시 운영과 실험일 운영의 용량 기준을 분리한다. 실제 production 현재값은 [Production Environment](production-environment.md)를 우선한다.

## Current Operating Assumption

- 현재 production traffic은 `realtime` 모드를 사용한다.
- `pipeline` 그룹 대화 모드는 현재 production에서 사용하지 않는다.
- 실험 조건에 따라 Realtime role은 `dominant` 또는 `collaborative`로 바뀐다.
- Supabase `app_settings`가 운영 모드 source of truth다.

## Instance Profiles

| 상황 | EC2 | 목적 |
|---|---|---|
| 평상시/연구자용 | `t3.medium` | 관리자 화면, 프롬프트 점검, 소수 Realtime 테스트 |
| 실험/수업용 | `m5.2xlarge` | 학생 24~25명의 동시 Realtime 세션 |

`t3.medium`은 CPU credit 기반이므로 장시간 고부하 수업 운영에는 적합하지 않다. 실험일에는 `m5.2xlarge`로 올리고, 실험 후 평상시 instance type으로 내린다.

## Realtime Experiment Target

| 항목 | 기준 |
|---|---|
| 학생 수 | 24~25명 |
| LiveKit room 수 | 학생당 1개 |
| Agent job 수 | 학생당 `realtime-agent` 1개 |
| LiveKit plan | Scale |
| OpenAI model | `gpt-realtime` |
| Primary risk | OpenAI Realtime rate/audio limits, worker burst handling, `/api/rooms` polling cost |

실험 전 확인:

- LiveKit Scale plan limit과 usage dashboard
- OpenAI project/model limit dashboard
- `cscl-agent.service` active 상태
- `cscl-client` PM2 상태
- `https://tblt-agent.net/api/health`
- Supabase `app_settings.agent_mode`

## Legacy Pipeline Reference

과거 `pipeline` 기준 문서의 15세션 분석은 현재 production 기준이 아니다. `pipeline`을 다시 운영할 때만 별도 용량 검토를 수행한다.

과거 가정:

- 학생 30명
- 2인 1그룹 기준 최대 15 room
- 로컬 Silero VAD와 turn detector가 EC2 CPU/RAM 분석의 주요 관심사

현재 Realtime 운영에서는 병목 순서가 다르므로 이 값을 현재 production 사양 근거로 사용하지 않는다.
