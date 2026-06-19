# ADR 0003: Use Single Agent Systemd Service

Date: 2026-06-19
Status: accepted

## Context

Repository docs previously described split services:

- `cscl-agent-pipeline.service`
- `cscl-agent-realtime.service`

Production EC2 currently runs a single enabled and active service:

- `cscl-agent.service`

The deploy script previously restarted the split services by default, which did not match production reality.

## Decision

Use `cscl-agent.service` as the default production agent service.

`scripts/deploy-production.sh` now restarts `cscl-agent` by default. It still supports `AGENT_SERVICES="..."` override for future split-service deployments.

## Consequences

- Production source-of-truth docs list `cscl-agent.service`.
- Deployment runbook uses `sudo systemctl restart cscl-agent`.
- Old split service docs are superseded unless production intentionally returns to split services.
