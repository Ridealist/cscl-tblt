alter table public.conversation_events
add column if not exists student_id uuid references public.students(id) on delete set null;

alter table public.conversation_events
add column if not exists student_name text;

create index if not exists conversation_events_student_id_created_at_idx
on public.conversation_events (student_id, created_at, sequence);

create or replace function public.set_conversation_event_student_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.student_id is not null and nullif(btrim(coalesce(new.student_name, '')), '') is null then
    select s.name
    into new.student_name
    from public.students s
    where s.id = new.student_id;
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_events_set_student_name on public.conversation_events;
create trigger conversation_events_set_student_name
before insert or update of student_id, student_name on public.conversation_events
for each row
execute function public.set_conversation_event_student_name();

with session_students as (
  select
    s.id,
    (s.metadata->>'student_id')::uuid as student_id,
    nullif(s.metadata->>'student_name', '') as student_name
  from public.class_sessions s
  where nullif(s.metadata->>'student_id', '') is not null
    and (s.metadata->>'student_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
update public.conversation_events e
set
  student_id = ss.student_id,
  student_name = coalesce(st.name, ss.student_name)
from session_students ss
left join public.students st
  on st.id = ss.student_id
where e.session_id = ss.id
  and e.role = 'user'
  and e.student_id is null;

comment on column public.conversation_events.student_id is
'Student roster foreign key for user utterances when the speaker can be resolved.';

comment on column public.conversation_events.student_name is
'Snapshot of the resolved student name at event write time for display and historical stability.';

notify pgrst, 'reload schema';
