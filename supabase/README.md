# Supabase Foundation

This directory contains the database foundation for the staged Supabase migration tracked in GitHub issue #4.

## Current Scope

The first migration adds only the shared foundation needed by later issues:

- `profiles`: Supabase Auth user metadata and app role.
- `app_settings`: future replacement for `config.json`.
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

Until #32 is implemented, the app still uses the existing Basic Auth middleware for admin routes.

## Local Development Policy

Supabase is optional during this foundation step. Existing `config.json`, `prompt_config.json`, and `logs/*.json` behavior remains unchanged until the follow-up migration issues wire routes to the Supabase-backed stores.

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
