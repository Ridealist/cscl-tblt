alter table public.prompt_versions
add column if not exists condition_combination_prompts jsonb not null default '{}'::jsonb;

alter table public.prompt_versions
drop constraint if exists prompt_versions_condition_combination_prompts_check,
drop constraint if exists prompt_versions_shape_check;

alter table public.prompt_versions
add constraint prompt_versions_condition_combination_prompts_check
check (jsonb_typeof(condition_combination_prompts) = 'object'),
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
  )
);

drop function if exists public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid
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
  p_condition_combination_prompts jsonb default '{}'::jsonb
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
        'taskCardPrompt', p_task_card_prompt
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

drop function if exists public.import_prompt_version(
  text, text, text, timestamptz, boolean, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text
);
drop function if exists public.import_prompt_version(
  text, text, text, timestamptz, boolean, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, jsonb
);

create or replace function public.import_prompt_version(
  p_purpose text,
  p_label text,
  p_hash text,
  p_created_at timestamptz,
  p_is_active boolean,
  p_legacy_file_version_id text,
  p_legacy_file_purpose text,
  p_base_prompt text default null,
  p_dominant_prompt text default null,
  p_collaborative_prompt text default null,
  p_feedback_condition_id text default null,
  p_feedback_prompt text default null,
  p_task_card_id text default null,
  p_task_card_prompt text default null,
  p_evaluation_id text default null,
  p_evaluation_prompt text default null,
  p_evaluation_prompt_version text default null,
  p_evaluation_character text default null,
  p_evaluation_opening_sentence text default null,
  p_condition_combination_prompts jsonb default '{}'::jsonb
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  normalized_purpose text := nullif(trim(p_purpose), '');
  normalized_evaluation_id text := nullif(trim(coalesce(p_evaluation_id, '')), '');
  normalized_legacy_file_version_id text := nullif(trim(coalesce(p_legacy_file_version_id, '')), '');
  normalized_legacy_file_purpose text := nullif(trim(coalesce(p_legacy_file_purpose, '')), '');
  normalized_condition_combination_prompts jsonb :=
    case
      when jsonb_typeof(coalesce(p_condition_combination_prompts, '{}'::jsonb)) = 'object'
      then coalesce(p_condition_combination_prompts, '{}'::jsonb)
      else '{}'::jsonb
    end;
  inserted public.prompt_versions;
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  if normalized_purpose not in ('practice', 'evaluation') then
    raise exception 'Invalid prompt version purpose.' using errcode = '22023';
  end if;

  if normalized_legacy_file_version_id is null
     or normalized_legacy_file_purpose not in ('realtime', 'evaluation') then
    raise exception 'Legacy file identity is required.' using errcode = '22023';
  end if;

  if p_is_active then
    perform pg_advisory_xact_lock(
      hashtext('prompt_versions_active:' || normalized_purpose || ':' || coalesce(normalized_evaluation_id, ''))
    );

    update public.prompt_versions
    set is_active = false
    where purpose = normalized_purpose
      and is_active = true
      and (
        normalized_purpose = 'practice'
        or evaluation_id = normalized_evaluation_id
      );
  end if;

  insert into public.prompt_versions (
    purpose,
    label,
    hash,
    created_at,
    is_active,
    source,
    legacy_file_version_id,
    legacy_file_purpose,
    base_prompt,
    dominant_prompt,
    collaborative_prompt,
    feedback_condition_id,
    feedback_prompt,
    condition_combination_prompts,
    task_card_id,
    task_card_prompt,
    evaluation_id,
    evaluation_prompt,
    evaluation_prompt_version,
    evaluation_character,
    evaluation_opening_sentence
  )
  values (
    normalized_purpose,
    coalesce(nullif(trim(coalesce(p_label, '')), ''), normalized_purpose || ' ' || coalesce(p_created_at, now())::text),
    nullif(trim(coalesce(p_hash, '')), ''),
    coalesce(p_created_at, now()),
    coalesce(p_is_active, false),
    'custom',
    normalized_legacy_file_version_id,
    normalized_legacy_file_purpose,
    p_base_prompt,
    p_dominant_prompt,
    p_collaborative_prompt,
    p_feedback_condition_id,
    p_feedback_prompt,
    normalized_condition_combination_prompts,
    p_task_card_id,
    p_task_card_prompt,
    normalized_evaluation_id,
    p_evaluation_prompt,
    nullif(trim(coalesce(p_evaluation_prompt_version, '')), ''),
    p_evaluation_character,
    p_evaluation_opening_sentence
  )
  on conflict (legacy_file_purpose, legacy_file_version_id)
  where legacy_file_version_id is not null
  do update set
    purpose = excluded.purpose,
    label = excluded.label,
    hash = excluded.hash,
    created_at = excluded.created_at,
    is_active = excluded.is_active,
    base_prompt = excluded.base_prompt,
    dominant_prompt = excluded.dominant_prompt,
    collaborative_prompt = excluded.collaborative_prompt,
    feedback_condition_id = excluded.feedback_condition_id,
    feedback_prompt = excluded.feedback_prompt,
    condition_combination_prompts = excluded.condition_combination_prompts,
    task_card_id = excluded.task_card_id,
    task_card_prompt = excluded.task_card_prompt,
    evaluation_id = excluded.evaluation_id,
    evaluation_prompt = excluded.evaluation_prompt,
    evaluation_prompt_version = excluded.evaluation_prompt_version,
    evaluation_character = excluded.evaluation_character,
    evaluation_opening_sentence = excluded.evaluation_opening_sentence
  returning * into inserted;

  return inserted;
end;
$$;

drop function if exists public.activate_realtime_prompt_version(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
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
    '{}'::jsonb
  );

  select *
  into result
  from public.realtime_prompt_versions
  where id = saved.id;

  return result;
end;
$$;

revoke all on function public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid, jsonb
) from public;
revoke all on function public.import_prompt_version(
  text, text, text, timestamptz, boolean, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, jsonb
) from public;
revoke all on function public.activate_realtime_prompt_version(
  text, text, text, text, text, text, text, uuid
) from public;

grant execute on function public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid, jsonb
) to authenticated, service_role;
grant execute on function public.import_prompt_version(
  text, text, text, timestamptz, boolean, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, jsonb
) to authenticated, service_role;
grant execute on function public.activate_realtime_prompt_version(
  text, text, text, text, text, text, text, uuid
) to authenticated, service_role;
