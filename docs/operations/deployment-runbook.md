# Deployment Runbook

Status: current
Last verified: 2026-06-19

이 문서는 production 배포 절차를 다룬다. 현재 인프라와 서비스명은 [Production Environment](production-environment.md)를 기준으로 한다.

## Automated Deployment

Production 배포는 GitHub Actions의 `Deploy Production` workflow가 수행한다.

| 항목 | 값 |
|---|---|
| Workflow | `.github/workflows/cd.yml` |
| Trigger | `main` push 또는 manual dispatch |
| Remote script | `scripts/deploy-production.sh` |
| App directory | `PROD_APP_DIR` 또는 기본값 `/opt/cscl-tblt` |

필요한 GitHub Environment/Secrets:

| 이름 | 종류 | 설명 |
|---|---|---|
| `PROD_SSH_HOST` | Secret | EC2 host 또는 IP |
| `PROD_SSH_USER` | Secret | 배포 SSH 사용자, 예: `ubuntu` |
| `PROD_SSH_KEY` | Secret | 배포용 private key |
| `PROD_SSH_PORT` | Secret | SSH port, 기본값 `22` |
| `PROD_APP_DIR` | Environment variable | 서버 repo 경로, 기본값 `/opt/cscl-tblt` |

## Deploy Script Behavior

`scripts/deploy-production.sh`는 기본적으로 다음을 수행한다.

1. runtime state 파일 백업
2. `main` fetch 및 target ref checkout
3. runtime state 파일 복원
4. Realtime prompt source 검사
5. client dependency install 및 build
6. agent dependency sync 및 model file download
7. `cscl-agent.service` 재시작
8. `cscl-client` PM2 process 재시작
9. `http://localhost:3000/api/health` 확인

배포 중 보존되는 runtime state 파일:

```text
.env
client/.env.local
config.json
prompt_config.json
```

`config.json`과 `prompt_config.json`은 production runtime source of truth가 아니다. 현재 production 설정은 Supabase `app_settings`와 `realtime_prompt_versions`를 따른다.

## Manual Verification

배포 후 EC2에서 확인한다.

```bash
cd /opt/cscl-tblt
sudo systemctl is-active cscl-agent
pm2 describe cscl-client
curl -fsS http://localhost:3000/api/health
```

외부 확인:

```bash
curl -fsS https://tblt-agent.net/api/health
```

관리자 UI 확인:

```text
https://tblt-agent.net/admin/login
```

## Manual Restart

배포 없이 runtime만 재시작해야 할 때:

```bash
sudo systemctl restart cscl-agent
pm2 restart cscl-client --update-env
curl -fsS http://localhost:3000/api/health
```

## Service Override

현재 production 기본값은 단일 `cscl-agent.service`다. 향후 복수 agent 서비스로 되돌릴 경우 deploy script 실행 시 명시적으로 override한다.

```bash
AGENT_SERVICES="cscl-agent-pipeline cscl-agent-realtime" ./scripts/deploy-production.sh
```

## Server Requirements

- `/opt/cscl-tblt`가 Git checkout이어야 한다.
- 배포 사용자는 `systemctl restart/is-active cscl-agent`를 password 없이 실행할 수 있어야 한다.
- `pnpm`, `uv`, `pm2`, `curl`, `python3`, `git`이 설치되어 있어야 한다.
- `client/.env.local`에는 Next.js server-side 환경변수가 있어야 한다.
- `/opt/cscl-tblt/.env`에는 agent 환경변수가 있어야 한다.
