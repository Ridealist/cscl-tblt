# Incident Checklist

Status: current
Last verified: 2026-06-19

장애 대응 시 현재 서비스명과 경로는 [Production Environment](production-environment.md)를 따른다.

## First Checks

```bash
curl -fsS http://localhost:3000/api/health
pm2 list
sudo systemctl status cscl-agent
```

외부에서 확인:

```bash
curl -fsS https://tblt-agent.net/api/health
```

## Agent Logs

```bash
sudo journalctl -u cscl-agent --no-pager | tail -80
sudo journalctl -u cscl-agent -f
```

확인할 항목:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` 관련 오류
- `OPENAI_API_KEY` 또는 Realtime connection 오류
- Supabase URL/secret 관련 오류
- `languages.json not found` 같은 model file 누락
- repeated restart loop

## Client Logs

```bash
pm2 describe cscl-client
pm2 logs cscl-client --lines 80
```

확인할 항목:

- `.env.local` 누락 또는 server-side env 누락
- Supabase auth/config route 오류
- `/api/token`, `/api/rooms`, `/api/health` 오류
- build mismatch로 인한 temporary Server Action 오류

## External Dashboards

- LiveKit Cloud: active room, agent session, usage, errors
- OpenAI dashboard: Realtime usage, rate limit, error rate
- Supabase dashboard: Auth, `app_settings`, API logs
- AWS S3: recording upload status

## Quick Recovery

```bash
sudo systemctl restart cscl-agent
pm2 restart cscl-client --update-env
curl -fsS http://localhost:3000/api/health
```

`main` 배포 이후 문제가 발생했고 코드 변경이 의심되면 GitHub Actions deploy log와 최근 commit을 먼저 확인한다.
