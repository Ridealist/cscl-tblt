create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  livekit_session_id text not null,
  room_name text not null,
  agent_mode text not null check (agent_mode in ('pipeline', 'realtime')),
  agent_role text check (agent_role in ('dominant', 'collaborative')),
  feedback_condition_id text,
  task_card_id text,
  prompt_version_id uuid references public.realtime_prompt_versions(id) on delete set null,
  egress_id text,
  recording_path text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists class_sessions_livekit_session_id_key
on public.class_sessions (livekit_session_id);

create index if not exists class_sessions_started_at_idx
on public.class_sessions (started_at desc);

create index if not exists class_sessions_room_name_started_at_idx
on public.class_sessions (room_name, started_at desc);

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  role text not null check (role in ('user', 'agent')),
  text text not null,
  participant_identity text,
  participant_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists conversation_events_session_sequence_key
on public.conversation_events (session_id, sequence);

create index if not exists conversation_events_session_created_at_idx
on public.conversation_events (session_id, created_at, sequence);

alter table public.class_sessions enable row level security;
alter table public.conversation_events enable row level security;

drop policy if exists "Admins can read class sessions" on public.class_sessions;
create policy "Admins can read class sessions"
on public.class_sessions
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can read conversation events" on public.conversation_events;
create policy "Admins can read conversation events"
on public.conversation_events
for select
to authenticated
using (public.is_admin(auth.uid()));

grant select on public.class_sessions to authenticated;
grant select on public.conversation_events to authenticated;
grant select, insert, update on public.class_sessions to service_role;
grant select, insert on public.conversation_events to service_role;

comment on table public.class_sessions is 'LiveKit class session records written by the realtime agent while file logging remains enabled.';
comment on table public.conversation_events is 'Ordered user and agent utterance events for class_sessions.';
comment on column public.class_sessions.livekit_session_id is 'LiveKit room SID used by the existing file logger as session_id.';
comment on column public.conversation_events.sequence is 'Monotonic per-session event order assigned by ConversationLogger.';
