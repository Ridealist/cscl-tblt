# Production Environment

Last verified: 2026-06-19
Status: current
Source of truth: yes

이 문서는 production의 현재 운영 기준값을 기록한다. 다른 문서가 인스턴스 타입, 서비스명, 운영 모드, 외부 서비스 플랜을 언급할 때는 이 문서를 우선한다.

## Infrastructure

| 항목 | 값 |
|---|---|
| EC2 instance type | 평상시/연구자용 `t3.medium`, 실험/수업용 `m5.2xlarge` |
| OS | Ubuntu 24.04.4 LTS, GNU/Linux 6.17.0-1017-aws x86_64 |
| Region | Asia Pacific (Seoul), `ap-northeast-2` |
| Domain | `https://tblt-agent.net/` |
| Project path | `/opt/cscl-tblt` |
| Runtime branch | `main` |

## Runtime Services

| 항목 | 값 |
|---|---|
| Client manager | PM2 |
| Client process | `cscl-client` |
| Client port | `3000` |
| Agent service | `cscl-agent.service` |
| Agent boot state | enabled |
| Agent runtime state | active |
| Agent working directory | `/opt/cscl-tblt/agent` |
| Agent environment file | `/opt/cscl-tblt/.env` |
| Agent command | `/home/ubuntu/.local/bin/uv run python main.py start` |

Current production traffic uses `realtime`. `pipeline` is not used in current production.

## Runtime Configuration

| 항목 | 값 |
|---|---|
| Operation mode source of truth | Supabase `app_settings` |
| `config.json` role in production | fallback/import reference only |
| Supabase migration status | complete |
| Current operation mode | `realtime` |
| Current realtime role | `dominant` 또는 `collaborative`, experiment condition에 따라 선택 |

## External Services

| 서비스 | 값 |
|---|---|
| LiveKit project | `https://cloud.livekit.io/projects/p_z18np1otkdw/overview` |
| LiveKit plan | Scale |
| OpenAI realtime model | `gpt-realtime` |
| OpenAI pipeline LLM model | current production에서 사용하지 않음 |
| OpenAI usage tier | Tier 4 |
| OpenAI realtime limit snapshot | `gpt-realtime`: 10,000 RPM / 4,000,000 TPM |
| Supabase | production에서 사용, `app_settings` source of truth |
| S3 bucket | `tblt-agent-recordings` |
| S3 bucket ARN | `arn:aws:s3:::tblt-agent-recordings` |
| S3 region | `ap-northeast-2` |

LiveKit plan limits and OpenAI rate limits can change by account, project, model, and date. Verify both dashboards before experiment day.

## Deployment

| 항목 | 값 |
|---|---|
| Deployment method | GitHub Actions |
| Workflow | `.github/workflows/cd.yml` |
| Deploy script | `scripts/deploy-production.sh` |
| Services restarted after deploy | `cscl-agent.service`, `cscl-client` |
| Local health check | `http://localhost:3000/api/health` |
| External health check | `https://tblt-agent.net/api/health` |

## Server Verification Commands

```bash
systemctl list-unit-files | grep cscl-agent
systemctl list-units --type=service | grep cscl-agent
sudo systemctl status cscl-agent
sudo systemctl cat cscl-agent
pm2 list
pm2 describe cscl-client
curl -fsS http://localhost:3000/api/health
```
