# Supabase Foundation

This directory contains the database foundation for the staged Supabase migration tracked in GitHub issue #4.

기존 EC2 production 서버에 Supabase를 적용할 때는 repo root의
`docs/production-supabase-runbook.md`를 우선 따른다. 이 문서는 schema와
local/persistent storage 정책의 세부 설명이다.

## Current Scope

The migrations add the shared foundation used by the staged Supabase rollout:

- `profiles`: Supabase Auth user metadata and app role.
- `app_settings`: runtime storage for class, agent, and session purpose operation settings.
- `realtime_prompt_versions`: versioned Realtime prompt overrides that replace
  `prompt_config.json`.
- `class_sessions`: LiveKit class session metadata written by `ConversationLogger`.
- `conversation_events`: ordered user/agent utterance events for each class session.
- `students`: student records and plain per-student access codes used by the main login flow.

## Environment Variables

The Next.js API routes and Python realtime agent use these values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
STUDENT_SESSION_SECRET=<long-random-server-only-secret>
```

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may be exposed to browser code. `SUPABASE_SECRET_KEY` and `STUDENT_SESSION_SECRET` must stay server-only. The Supabase secret bypasses Row Level Security; the student session secret signs the HttpOnly student login cookie. The Python realtime agent reads the same Supabase URL and secret from root `.env` when resolving a custom `promptVersionId` and dual-writing conversation logs.

## Bootstrap

1. Create a Supabase project.
2. Apply `supabase/migrations/20260611000000_foundation.sql`.
3. Apply `supabase/migrations/20260612070000_session_purpose_and_activity.sql` before
   using Evaluation/Practice session filtering.
4. Create the first admin user through Supabase Auth.
5. Grant that user admin access from SQL or the dashboard:

```sql
insert into public.profiles (user_id, role, display_name)
values ('<auth-user-id>', 'admin', 'Admin')
on conflict (user_id) do update
set role = 'admin',
    display_name = excluded.display_name;
```

Admin routes use Supabase Auth sessions and `profiles.role = 'admin'` checks.

## Local Development Policy

Production uses Supabase `app_settings(id = 'default')` as the source of truth for class count, active class, agent mode, agent role, feedback condition, session purpose (`session_purpose = practice | evaluation`), and realtime reset lock state. Custom Realtime prompt overrides are stored as rows in `realtime_prompt_versions`; at most one row is active.

Local development may run without Supabase for the settings store. When the Supabase admin environment variables are missing, or a local Supabase read/write fails, the Next.js settings store falls back to root `config.json`. This fallback is for local development and migration only; production returns a setup/runtime error instead.

Prompt editing requires Supabase when saving a custom prompt version. Without an active prompt row, the admin prompt API, token route, and Python realtime agent use the tracked markdown defaults under `prompts/realtime/`. With an active prompt row, `/api/token` records its `promptVersionId` in LiveKit metadata and the agent fetches that exact row from Supabase.

The public student flow requires Supabase-backed `students` rows. Students first authenticate on the main screen with 학번, 이름, and their per-student access code; the server then sets a signed HttpOnly `student_session` cookie. `/api/token` requires that cookie and derives the LiveKit participant identity from the authenticated student instead of trusting a browser-supplied name.

Conversation logging keeps the existing `logs/*.json` file write and adds Supabase dual-write when the Python agent has `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` plus `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. Each `ConversationLogger` instance creates a new `class_sessions.id`; `livekit_session_id` is retained as LiveKit room metadata and is not unique because named rooms can be reused across conversations. Missing or failing Supabase writes are logged by the agent and do not stop the session.

Admin dashboard log APIs read `class_sessions` and `conversation_events` through the server-only Supabase secret key. The old `logs/*.json` reader is fallback-only for local development when Supabase admin environment variables are missing and `NODE_ENV !== 'production'`; configured Supabase read failures are surfaced instead of being hidden by file fallback. Production dashboard log reads are Supabase-backed and remain behind the admin guard. Evaluation filtering depends on `class_sessions.session_purpose`, `activity_type`, and `evaluation_id`, so apply `20260612070000_session_purpose_and_activity.sql` before relying on dashboard filters. Set `CONVERSATION_LOG_FILE_FALLBACK=false` to disable the local file fallback during development.

`supabase/config.toml` pins this repo to the `5532x` local port range so it can run alongside another Supabase project using the CLI defaults.

```bash
supabase start
supabase db reset --no-seed
supabase status
```

Use the `supabase status` output in `client/.env.local`, and provide the URL plus server-only secret to root `.env` for the Python agent:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key-from-supabase-status>
SUPABASE_SECRET_KEY=<secret-key-from-supabase-status>
```

Local Studio runs at `http://127.0.0.1:55323`; the local database URL is `postgresql://postgres:postgres@127.0.0.1:55322/postgres`.

## Student Login Seed

Apply `supabase/migrations/20260612030000_student_login.sql` and `supabase/migrations/20260612040000_student_access_code_on_students.sql`, then seed one row per student. `student_number` is the login identifier, `name` is the roster name, `class_number` is the class, `roll_number` is the student's number within that class, and `english_name` is used as the default editable display name in the lobby. If `access_code` is omitted, the database generates a unique 4-character lowercase alphanumeric code containing at least one letter and one digit.

```sql
insert into public.students (student_number, name, english_name, class_number, roll_number)
values
  ('20260001', '김민지', 'Minji Kim', 9, 1),
  ('20260002', '이서준', 'Seojun Lee', 9, 2)
on conflict (student_number) do update
set name = excluded.name,
    english_name = excluded.english_name,
    class_number = excluded.class_number,
    roll_number = excluded.roll_number,
    active = true;
```

Admins can read generated student codes directly for classroom distribution:

```sql
select student_number, name, class_number, roll_number, access_code
from public.students
order by class_number, roll_number;
```

To set a code manually, provide a 4-character lowercase alphanumeric value that includes at least one letter and one digit. Codes are unique across `students`.

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
  session_purpose,
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
  'practice',
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
    session_purpose = excluded.session_purpose,
    realtime_resetting = excluded.realtime_resetting;
```

Use `session_purpose = 'practice'` for the existing TBLT task-solution flow, and
`session_purpose = 'evaluation'` for Kate free-conversation source-data
collection. Non-evaluation `class_sessions` rows are normalized to `practice` by
the session-purpose migration, and existing rows are backfilled with
`activity_type` plus evaluation prompt fields where metadata or `eval-*` room
names make that possible.

## realtime_prompt_versions Migration

To migrate an existing root `prompt_config.json` override, create one active version row that snapshots every resolved prompt field. If the old file only contains `basePrompt`, role prompts, and `taskCardId`, first resolve `feedbackPrompt`, `feedbackConditionId`, and `taskCardPrompt` from the current tracked markdown defaults and `app_settings.feedback_condition_id`.

```sql
select public.activate_realtime_prompt_version(
  p_base_prompt := '<prompt_config.json realtime.basePrompt>',
  p_dominant_prompt := '<prompt_config.json realtime.dominantPrompt>',
  p_collaborative_prompt := '<prompt_config.json realtime.collaborativePrompt>',
  p_feedback_condition_id := '<resolved feedback condition id>',
  p_feedback_prompt := '<resolved or edited feedback prompt>',
  p_task_card_id := '<resolved task card id>',
  p_task_card_prompt := '<resolved task card prompt>',
  p_created_by := '<admin auth user id>'
);
```

After verifying `/admin` shows the migrated prompt as the active custom version, remove the old `prompt_config.json` from the runtime host so it is not mistaken for the source of truth. Runtime Realtime sessions use LiveKit metadata `promptVersionId` plus Supabase `realtime_prompt_versions`; sessions without a custom version use tracked markdown defaults.
