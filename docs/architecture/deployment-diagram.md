# Deployment Diagram

Status: current
Last verified: 2026-06-19

현재 production 배포 구성은 [Production Environment](../operations/production-environment.md)를 기준으로 한다.

```text
Browser
  |
  | HTTPS
  v
tblt-agent.net
  |
  v
nginx
  |
  v
Next.js client, PM2: cscl-client, port 3000
  |
  +-- Supabase app_settings / auth / realtime_prompt_versions
  |
  +-- LiveKit token issuance
  |
  v
LiveKit Cloud
  |
  +-- WebRTC rooms
  |
  +-- Agent dispatch
  |
  v
EC2 agent, systemd: cscl-agent.service
  |
  +-- OpenAI gpt-realtime
  |
  +-- Supabase prompt/config fetch
  |
  +-- S3 recording bucket: tblt-agent-recordings
```

Current production traffic uses Realtime mode. Pipeline mode is retained in code but is not the current production traffic path.
