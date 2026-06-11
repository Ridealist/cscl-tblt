# Supabase Foundation

This directory contains the database foundation for the staged Supabase migration tracked in GitHub issue #4.

## Current Scope

The first migration adds the shared foundation used by the staged Supabase rollout:

- `profiles`: Supabase Auth user metadata and app role.
- `app_settings`: runtime storage for class and agent operation settings.
- `realtime_prompt_versions`: future replacement for `prompt_config.json`.

Conversation log tables are intentionally deferred to #36, where `ConversationLogger` will introduce dual-write behavior.

## Environment Variables

The Next.js client uses these values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may be exposed to browser code. `SUPABASE_SECRET_KEY` must stay server-only because it bypasses Row Level Security.

## Bootstrap

1. Create a Supabase project.
2. Apply `supabase/migrations/20260611000000_foundation.sql`.
3. Create the first admin user through Supabase Auth.
4. Grant that user admin access from SQL or the dashboard:

```sql
insert into public.profiles (user_id, role, display_name)
values ('<auth-user-id>', 'admin', 'Admin')
on conflict (user_id) do update
set role = 'admin',
    display_name = excluded.display_name;
```

Admin routes use Supabase Auth sessions and `profiles.role = 'admin'` checks.

## Local Development Policy

Production uses Supabase `app_settings(id = 'default')` as the source of truth for class count, active class, agent mode, agent role, feedback condition, and realtime reset lock state.

Local development may run without Supabase for the settings store. When the Supabase admin environment variables are missing, or a local Supabase read/write fails, the Next.js settings store falls back to root `config.json`. This fallback is for local development and migration only; production returns a setup/runtime error instead.

`supabase/config.toml` pins this repo to the `5532x` local port range so it can run alongside another Supabase project using the CLI defaults.

```bash
supabase start
supabase db reset --no-seed
supabase status
```

Use the `supabase status` output in `client/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key-from-supabase-status>
SUPABASE_SECRET_KEY=<secret-key-from-supabase-status>
```

Local Studio runs at `http://127.0.0.1:55323`; the local database URL is `postgresql://postgres:postgres@127.0.0.1:55322/postgres`.

## app_settings Seed

Import existing `config.json` values into the default row before production use:

```sql
insert into public.app_settings (
  id,
  num_classes,
  num_groups_per_class,
  class_start,
  active_class,
  agent_mode,
  agent_role,
  feedback_condition_id,
  realtime_resetting
)
values (
  'default',
  4,
  12,
  9,
  9,
  'realtime',
  'collaborative',
  'explicit_correction',
  false
)
on conflict (id) do update
set num_classes = excluded.num_classes,
    num_groups_per_class = excluded.num_groups_per_class,
    class_start = excluded.class_start,
    active_class = excluded.active_class,
    agent_mode = excluded.agent_mode,
    agent_role = excluded.agent_role,
    feedback_condition_id = excluded.feedback_condition_id,
    realtime_resetting = excluded.realtime_resetting;
```
