drop index if exists public.class_sessions_livekit_session_id_key;

create index if not exists class_sessions_livekit_session_id_idx
on public.class_sessions (livekit_session_id);

comment on column public.class_sessions.livekit_session_id is
'LiveKit room SID. Multiple class_sessions rows may share this value when a named room is reused across separate conversations.';
