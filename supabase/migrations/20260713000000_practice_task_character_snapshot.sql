alter table public.prompt_versions
add column if not exists task_character jsonb;

alter table public.prompt_versions
drop constraint if exists prompt_versions_task_character_check,
drop constraint if exists prompt_versions_shape_check;

alter table public.prompt_versions
add constraint prompt_versions_task_character_check
check (
  task_character is null
  or (
    jsonb_typeof(task_character) = 'object'
    and task_character ?& array[
      'id', 'displayName', 'avatarSrc', 'voiceId', 'ttsSpeed', 'ttsVolume'
    ]
    and jsonb_typeof(task_character -> 'id') = 'string'
    and jsonb_typeof(task_character -> 'displayName') = 'string'
    and jsonb_typeof(task_character -> 'avatarSrc') = 'string'
    and jsonb_typeof(task_character -> 'voiceId') = 'string'
    and jsonb_typeof(task_character -> 'ttsSpeed') = 'number'
    and jsonb_typeof(task_character -> 'ttsVolume') = 'number'
  )
),
add constraint prompt_versions_shape_check
check (
  (
    purpose = 'practice'
    and evaluation_id is null
    and evaluation_prompt is null
    and evaluation_prompt_version is null
    and evaluation_character is null
    and evaluation_opening_sentence is null
    and base_prompt is not null
    and dominant_prompt is not null
    and collaborative_prompt is not null
    and feedback_condition_id is not null
    and feedback_prompt is not null
    and task_card_id is not null
    and task_card_prompt is not null
    and condition_combination_prompts is not null
  )
  or
  (
    purpose = 'evaluation'
    and evaluation_id is not null
    and evaluation_prompt is not null
    and evaluation_character is not null
    and evaluation_opening_sentence is not null
    and base_prompt is null
    and dominant_prompt is null
    and collaborative_prompt is null
    and feedback_condition_id is null
    and feedback_prompt is null
    and task_card_id is null
    and task_card_prompt is null
    and task_character is null
  )
);

drop function if exists public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid, jsonb
);

create or replace function public.save_practice_prompt_version(
  p_base_prompt text,
  p_dominant_prompt text,
  p_collaborative_prompt text,
  p_feedback_condition_id text,
  p_feedback_prompt text,
  p_task_card_id text,
  p_task_card_prompt text,
  p_label text default null,
  p_hash text default null,
  p_created_by uuid default null,
  p_condition_combination_prompts jsonb default '{}'::jsonb,
  p_task_character jsonb default null
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  inserted public.prompt_versions;
  normalized_condition_combination_prompts jsonb :=
    case
      when jsonb_typeof(coalesce(p_condition_combination_prompts, '{}'::jsonb)) = 'object'
      then coalesce(p_condition_combination_prompts, '{}'::jsonb)
      else '{}'::jsonb
    end;
  normalized_task_character jsonb :=
    case
      when jsonb_typeof(p_task_character) = 'object' then p_task_character
      else null
    end;
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('prompt_versions_active:practice:'));

  update public.prompt_versions
  set is_active = false
  where purpose = 'practice'
    and is_active = true;

  insert into public.prompt_versions (
    purpose,
    base_prompt,
    dominant_prompt,
    collaborative_prompt,
    feedback_condition_id,
    feedback_prompt,
    condition_combination_prompts,
    task_card_id,
    task_card_prompt,
    task_character,
    source,
    label,
    hash,
    is_active,
    created_by
  )
  values (
    'practice',
    p_base_prompt,
    p_dominant_prompt,
    p_collaborative_prompt,
    p_feedback_condition_id,
    p_feedback_prompt,
    normalized_condition_combination_prompts,
    p_task_card_id,
    p_task_card_prompt,
    normalized_task_character,
    'custom',
    coalesce(nullif(trim(coalesce(p_label, '')), ''), 'practice ' || now()::text),
    coalesce(nullif(trim(coalesce(p_hash, '')), ''), encode(extensions.digest(
      jsonb_build_object(
        'basePrompt', p_base_prompt,
        'collaborativePrompt', p_collaborative_prompt,
        'conditionCombinationPrompts', normalized_condition_combination_prompts,
        'dominantPrompt', p_dominant_prompt,
        'feedbackConditionId', p_feedback_condition_id,
        'feedbackPrompt', p_feedback_prompt,
        'taskCardId', p_task_card_id,
        'taskCardPrompt', p_task_card_prompt,
        'taskCharacter', normalized_task_character
      )::text,
      'sha256'
    ), 'hex')),
    true,
    coalesce(actor, p_created_by)
  )
  returning * into inserted;

  return inserted;
end;
$$;

drop function if exists public.activate_realtime_prompt_version(
  text, text, text, text, text, text, text, uuid
);

drop view if exists public.realtime_prompt_versions;

create view public.realtime_prompt_versions
with (security_invoker = true) as
select
  id,
  base_prompt,
  dominant_prompt,
  collaborative_prompt,
  feedback_condition_id,
  feedback_prompt,
  condition_combination_prompts,
  task_card_id,
  task_card_prompt,
  task_character,
  source,
  is_active,
  created_at,
  created_by
from public.prompt_versions
where purpose = 'practice';

grant select on public.realtime_prompt_versions to authenticated;
grant select on public.realtime_prompt_versions to service_role;

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
  saved public.prompt_versions;
  result public.realtime_prompt_versions;
begin
  saved := public.save_practice_prompt_version(
    p_base_prompt,
    p_dominant_prompt,
    p_collaborative_prompt,
    p_feedback_condition_id,
    p_feedback_prompt,
    p_task_card_id,
    p_task_card_prompt,
    null,
    null,
    p_created_by,
    '{}'::jsonb,
    null
  );

  select *
  into result
  from public.realtime_prompt_versions
  where id = saved.id;

  return result;
end;
$$;

revoke all on function public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid, jsonb, jsonb
) from public;
revoke all on function public.activate_realtime_prompt_version(
  text, text, text, text, text, text, text, uuid
) from public;

grant execute on function public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid, jsonb, jsonb
) to authenticated, service_role;
grant execute on function public.activate_realtime_prompt_version(
  text, text, text, text, text, text, text, uuid
) to authenticated, service_role;
