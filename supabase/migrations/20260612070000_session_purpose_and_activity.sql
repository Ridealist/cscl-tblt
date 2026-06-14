alter table public.app_settings
add column if not exists session_purpose text;

alter table public.app_settings
drop constraint if exists app_settings_session_purpose_check;

update public.app_settings
set session_purpose = 'practice'
where session_purpose is null
   or session_purpose <> 'evaluation';

alter table public.app_settings
alter column session_purpose set default 'practice',
alter column session_purpose set not null;

alter table public.app_settings
add constraint app_settings_session_purpose_check
check (session_purpose in ('evaluation', 'practice'));

comment on column public.app_settings.session_purpose is
'Current realtime session purpose used by admin prompt editing and default realtime session behavior.';

alter table public.class_sessions
add column if not exists session_purpose text,
add column if not exists activity_type text
  check (activity_type is null or activity_type in ('free_conversation', 'task_solution')),
add column if not exists evaluation_id text,
add column if not exists evaluation_prompt_id text,
add column if not exists evaluation_prompt_version text;

alter table public.class_sessions
drop constraint if exists class_sessions_session_purpose_check;

update public.class_sessions
set session_purpose = case
  when session_purpose = 'evaluation' then 'evaluation'
  when metadata ->> 'session_purpose' = 'evaluation' then 'evaluation'
  when metadata ->> 'sessionPurpose' = 'evaluation' then 'evaluation'
  when metadata ->> 'activity_type' = 'free_conversation' then 'evaluation'
  when metadata ->> 'activityType' = 'free_conversation' then 'evaluation'
  when room_name like 'eval-%' then 'evaluation'
  else 'practice'
end
where session_purpose is null
   or session_purpose not in ('evaluation', 'practice');

update public.class_sessions
set activity_type = case
  when metadata ->> 'activity_type' in ('free_conversation', 'task_solution')
    then metadata ->> 'activity_type'
  when metadata ->> 'activityType' in ('free_conversation', 'task_solution')
    then metadata ->> 'activityType'
  when session_purpose = 'evaluation' then 'free_conversation'
  else 'task_solution'
end
where activity_type is null
   or activity_type not in ('free_conversation', 'task_solution');

update public.class_sessions
set evaluation_id = coalesce(
    nullif(evaluation_id, ''),
    nullif(metadata ->> 'evaluation_id', ''),
    nullif(metadata ->> 'evaluationId', ''),
    'pretest_6_10'
  ),
  evaluation_prompt_id = coalesce(
    nullif(evaluation_prompt_id, ''),
    nullif(metadata ->> 'evaluation_prompt_id', ''),
    nullif(metadata ->> 'evaluationPromptId', ''),
    nullif(metadata ->> 'evaluation_id', ''),
    nullif(metadata ->> 'evaluationId', ''),
    'pretest_6_10'
  ),
  evaluation_prompt_version = coalesce(
    nullif(evaluation_prompt_version, ''),
    nullif(metadata ->> 'evaluation_prompt_version', ''),
    nullif(metadata ->> 'evaluationPromptVersion', ''),
    '2026-06-10'
  )
where session_purpose = 'evaluation';

alter table public.class_sessions
alter column session_purpose set default 'practice',
alter column session_purpose set not null;

alter table public.class_sessions
add constraint class_sessions_session_purpose_check
check (session_purpose in ('evaluation', 'practice'));

create index if not exists class_sessions_session_purpose_started_at_idx
on public.class_sessions (session_purpose, started_at desc);

create index if not exists class_sessions_activity_type_started_at_idx
on public.class_sessions (activity_type, started_at desc);

create index if not exists class_sessions_evaluation_id_started_at_idx
on public.class_sessions (evaluation_id, started_at desc);

comment on column public.class_sessions.session_purpose is
'High-level session purpose: evaluation for assessment source-data collection, practice for non-evaluation practice/task sessions.';

comment on column public.class_sessions.activity_type is
'Student-selected realtime activity: free_conversation or task_solution.';

comment on column public.class_sessions.evaluation_id is
'Stable evaluation identifier, such as pretest_6_10.';

comment on column public.class_sessions.evaluation_prompt_id is
'Evaluation prompt identifier applied to this session.';

comment on column public.class_sessions.evaluation_prompt_version is
'Human-readable evaluation prompt version applied to this session.';
