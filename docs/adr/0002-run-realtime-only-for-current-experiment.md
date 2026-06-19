# ADR 0002: Run Realtime For Current Production Experiment

Date: 2026-06-19
Status: accepted

## Context

The current experiment uses one-to-one student sessions. The previous production guide analyzed `pipeline` group conversations and local VAD/turn-detector CPU load. That analysis does not match the current Realtime operating path.

## Decision

Run current production traffic in `realtime` mode. Keep `pipeline` code available, but do not treat pipeline capacity assumptions as current production sizing.

Realtime role is selected by experiment condition:

- `dominant`
- `collaborative`

## Consequences

- Capacity planning prioritizes OpenAI Realtime limits, LiveKit room/agent-session usage, worker burst behavior, and dashboard polling cost.
- Pipeline 15-session VAD analysis is legacy reference, not current production source of truth.
- Experiment-day checklist must verify OpenAI and LiveKit dashboards before class.
