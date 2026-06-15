create or replace function public.activate_realtime_prompt_version(
  p_base_prompt text,
  p_dominant_prompt text,
  p_collaborative_prompt text,
  p_feedback_condition_id text,
  p_feedback_prompt text,
  p_task_card_id text,
  p_task_card_prompt text,
  p_created_by uuid default null
)
returns public.realtime_prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.realtime_prompt_versions;
  actor uuid := auth.uid();
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('realtime_prompt_versions_active'));

  update public.realtime_prompt_versions
  set is_active = false
  where is_active = true;

  insert into public.realtime_prompt_versions (
    base_prompt,
    dominant_prompt,
    collaborative_prompt,
    feedback_condition_id,
    feedback_prompt,
    task_card_id,
    task_card_prompt,
    source,
    is_active,
    created_by
  )
  values (
    p_base_prompt,
    p_dominant_prompt,
    p_collaborative_prompt,
    p_feedback_condition_id,
    p_feedback_prompt,
    p_task_card_id,
    p_task_card_prompt,
    'custom',
    true,
    coalesce(actor, p_created_by)
  )
  returning * into inserted;

  return inserted;
end;
$$;

create or replace function public.deactivate_realtime_prompt_versions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('realtime_prompt_versions_active'));

  update public.realtime_prompt_versions
  set is_active = false
  where is_active = true;
end;
$$;

revoke all on function public.activate_realtime_prompt_version(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) from public;
revoke all on function public.deactivate_realtime_prompt_versions() from public;

grant execute on function public.activate_realtime_prompt_version(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) to authenticated, service_role;
grant execute on function public.deactivate_realtime_prompt_versions() to authenticated, service_role;
