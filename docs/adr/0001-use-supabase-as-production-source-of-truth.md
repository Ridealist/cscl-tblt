# ADR 0001: Use Supabase As Production Source Of Truth

Date: 2026-06-19
Status: accepted

## Context

The application previously used local JSON files for runtime settings and prompt overrides. Production now needs admin-controlled settings and prompt versions that are shared by the Next.js client and Python realtime agent.

## Decision

Use Supabase as the production source of truth for runtime settings and realtime prompt versions.

- `app_settings` stores operation mode and classroom settings.
- `realtime_prompt_versions` stores custom Realtime prompt versions.
- `config.json` remains only as local fallback/import reference.
- `prompt_config.json` remains only as legacy migration/reference state.

## Consequences

- Production docs must not describe `config.json` as the active runtime source.
- Next.js API routes and Python realtime agent both need Supabase server-side credentials.
- Supabase dashboard and DB state are part of production verification.
