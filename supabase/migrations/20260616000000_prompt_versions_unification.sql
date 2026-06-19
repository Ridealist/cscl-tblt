do $$
begin
  if to_regclass('public.prompt_versions') is null
     and to_regclass('public.realtime_prompt_versions') is not null then
    alter table public.realtime_prompt_versions rename to prompt_versions;
  end if;
end;
$$;

alter table public.prompt_versions
add column if not exists purpose text,
add column if not exists label text,
add column if not exists hash text,
add column if not exists evaluation_id text,
add column if not exists evaluation_prompt text,
add column if not exists evaluation_prompt_version text,
add column if not exists evaluation_character text,
add column if not exists evaluation_opening_sentence text,
add column if not exists legacy_file_version_id text,
add column if not exists legacy_file_purpose text;

alter table public.prompt_versions
alter column base_prompt drop not null,
alter column dominant_prompt drop not null,
alter column collaborative_prompt drop not null,
alter column feedback_condition_id drop not null,
alter column feedback_prompt drop not null,
alter column task_card_id drop not null,
alter column task_card_prompt drop not null;

update public.prompt_versions
set purpose = 'practice'
where purpose is null;

update public.prompt_versions
set label = coalesce(nullif(label, ''), 'practice ' || created_at::text)
where label is null or label = '';

update public.prompt_versions
set hash = encode(
  extensions.digest(
    jsonb_build_object(
      'basePrompt', base_prompt,
      'collaborativePrompt', collaborative_prompt,
      'dominantPrompt', dominant_prompt,
      'feedbackConditionId', feedback_condition_id,
      'feedbackPrompt', feedback_prompt,
      'taskCardId', task_card_id,
      'taskCardPrompt', task_card_prompt
    )::text,
    'sha256'
  ),
  'hex'
)
where (hash is null or hash = '')
  and purpose = 'practice';

alter table public.prompt_versions
alter column purpose set not null,
alter column purpose set default 'practice',
alter column label set not null,
alter column hash set not null;

alter table public.prompt_versions
drop constraint if exists realtime_prompt_versions_source_check,
drop constraint if exists prompt_versions_source_check,
drop constraint if exists prompt_versions_purpose_check,
drop constraint if exists prompt_versions_shape_check,
drop constraint if exists prompt_versions_legacy_file_shape_check;

alter table public.prompt_versions
add constraint prompt_versions_source_check
check (source in ('custom')),
add constraint prompt_versions_purpose_check
check (purpose in ('practice', 'evaluation')),
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
),
add constraint prompt_versions_legacy_file_shape_check
check (
  (legacy_file_version_id is null and legacy_file_purpose is null)
  or
  (legacy_file_version_id is not null and legacy_file_purpose in ('realtime', 'evaluation'))
);

drop index if exists public.realtime_prompt_versions_one_active;
drop index if exists public.prompt_versions_one_active;
drop index if exists public.prompt_versions_one_active_practice;
drop index if exists public.prompt_versions_one_active_evaluation;
drop index if exists public.prompt_versions_legacy_file_version_key;
drop index if exists public.prompt_versions_purpose_created_at_idx;

create unique index prompt_versions_one_active_practice
on public.prompt_versions (purpose)
where purpose = 'practice' and is_active = true;

create unique index prompt_versions_one_active_evaluation
on public.prompt_versions (purpose, evaluation_id)
where purpose = 'evaluation' and is_active = true;

create unique index prompt_versions_legacy_file_version_key
on public.prompt_versions (legacy_file_purpose, legacy_file_version_id)
where legacy_file_version_id is not null;

create index prompt_versions_purpose_created_at_idx
on public.prompt_versions (purpose, created_at desc);

alter table public.prompt_versions enable row level security;

drop policy if exists "Admins can read realtime prompt versions" on public.prompt_versions;
drop policy if exists "Admins can insert realtime prompt versions" on public.prompt_versions;
drop policy if exists "Admins can update realtime prompt versions" on public.prompt_versions;
drop policy if exists "Admins can read prompt versions" on public.prompt_versions;
drop policy if exists "Admins can insert prompt versions" on public.prompt_versions;
drop policy if exists "Admins can update prompt versions" on public.prompt_versions;
drop policy if exists "Admins can delete prompt versions" on public.prompt_versions;

create policy "Admins can read prompt versions"
on public.prompt_versions
for select
to authenticated
using (public.is_admin(auth.uid()));

create policy "Admins can insert prompt versions"
on public.prompt_versions
for insert
to authenticated
with check (public.is_admin(auth.uid()));

create policy "Admins can update prompt versions"
on public.prompt_versions
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create policy "Admins can delete prompt versions"
on public.prompt_versions
for delete
to authenticated
using (public.is_admin(auth.uid()));

grant select, insert, update, delete on public.prompt_versions to authenticated;
grant select, insert, update, delete on public.prompt_versions to service_role;

create or replace function public.clear_active_prompt_versions(
  p_purpose text,
  p_evaluation_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  normalized_purpose text := nullif(trim(p_purpose), '');
  normalized_evaluation_id text := nullif(trim(coalesce(p_evaluation_id, '')), '');
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  if normalized_purpose not in ('practice', 'evaluation') then
    raise exception 'Invalid prompt version purpose.' using errcode = '22023';
  end if;

  if normalized_purpose = 'evaluation' and normalized_evaluation_id is null then
    raise exception 'Evaluation id is required.' using errcode = '22023';
  end if;

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
end;
$$;

drop function if exists public.activate_prompt_version(uuid);

create or replace function public.activate_prompt_version(
  p_version_id uuid,
  p_expected_purpose text default null
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  normalized_expected_purpose text := nullif(trim(coalesce(p_expected_purpose, '')), '');
  selected public.prompt_versions;
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  if normalized_expected_purpose is not null
     and normalized_expected_purpose not in ('practice', 'evaluation') then
    raise exception 'Invalid expected prompt version purpose.' using errcode = '22023';
  end if;

  select *
  into selected
  from public.prompt_versions
  where id = p_version_id;

  if selected.id is null then
    raise exception 'Prompt version was not found.' using errcode = 'P0002';
  end if;

  if normalized_expected_purpose is not null
     and selected.purpose <> normalized_expected_purpose then
    raise exception 'Prompt version purpose mismatch.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('prompt_versions_active:' || selected.purpose || ':' || coalesce(selected.evaluation_id, ''))
  );

  update public.prompt_versions
  set is_active = false
  where purpose = selected.purpose
    and is_active = true
    and (
      selected.purpose = 'practice'
      or evaluation_id = selected.evaluation_id
    );

  update public.prompt_versions
  set is_active = true
  where id = selected.id
  returning * into selected;

  return selected;
end;
$$;

drop function if exists public.delete_prompt_version(uuid);

create or replace function public.delete_prompt_version(
  p_version_id uuid,
  p_expected_purpose text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  normalized_expected_purpose text := nullif(trim(coalesce(p_expected_purpose, '')), '');
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  if normalized_expected_purpose is not null
     and normalized_expected_purpose not in ('practice', 'evaluation') then
    raise exception 'Invalid expected prompt version purpose.' using errcode = '22023';
  end if;

  delete from public.prompt_versions
  where id = p_version_id
    and (
      normalized_expected_purpose is null
      or purpose = normalized_expected_purpose
    );

  if not found then
    raise exception 'Prompt version was not found.' using errcode = 'P0002';
  end if;
end;
$$;

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
  p_created_by uuid default null
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  inserted public.prompt_versions;
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
    p_task_card_id,
    p_task_card_prompt,
    'custom',
    coalesce(nullif(trim(coalesce(p_label, '')), ''), 'practice ' || now()::text),
    coalesce(nullif(trim(coalesce(p_hash, '')), ''), encode(extensions.digest(
      jsonb_build_object(
        'basePrompt', p_base_prompt,
        'collaborativePrompt', p_collaborative_prompt,
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

create or replace function public.save_evaluation_prompt_version(
  p_evaluation_id text,
  p_evaluation_prompt text,
  p_evaluation_prompt_version text,
  p_evaluation_character text,
  p_evaluation_opening_sentence text,
  p_label text default null,
  p_hash text default null,
  p_created_by uuid default null,
  p_legacy_file_version_id text default null,
  p_legacy_file_purpose text default null
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  normalized_evaluation_id text := nullif(trim(p_evaluation_id), '');
  inserted public.prompt_versions;
begin
  if actor is not null and not public.is_admin(actor) then
    raise exception 'Admin role required.' using errcode = '42501';
  end if;

  if normalized_evaluation_id is null then
    raise exception 'Evaluation id is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('prompt_versions_active:evaluation:' || normalized_evaluation_id)
  );

  update public.prompt_versions
  set is_active = false
  where purpose = 'evaluation'
    and evaluation_id = normalized_evaluation_id
    and is_active = true;

  insert into public.prompt_versions (
    purpose,
    evaluation_id,
    evaluation_prompt,
    evaluation_prompt_version,
    evaluation_character,
    evaluation_opening_sentence,
    source,
    label,
    hash,
    is_active,
    created_by,
    legacy_file_version_id,
    legacy_file_purpose
  )
  values (
    'evaluation',
    normalized_evaluation_id,
    p_evaluation_prompt,
    nullif(trim(coalesce(p_evaluation_prompt_version, '')), ''),
    p_evaluation_character,
    p_evaluation_opening_sentence,
    'custom',
    coalesce(nullif(trim(coalesce(p_label, '')), ''), 'evaluation ' || now()::text),
    coalesce(nullif(trim(coalesce(p_hash, '')), ''), encode(extensions.digest(
      jsonb_build_object(
        'evaluationCharacter', p_evaluation_character,
        'evaluationId', normalized_evaluation_id,
        'evaluationPromptVersion', nullif(trim(coalesce(p_evaluation_prompt_version, '')), ''),
        'openingSentence', p_evaluation_opening_sentence,
        'prompt', p_evaluation_prompt
      )::text,
      'sha256'
    ), 'hex')),
    true,
    coalesce(actor, p_created_by),
    nullif(trim(coalesce(p_legacy_file_version_id, '')), ''),
    nullif(trim(coalesce(p_legacy_file_purpose, '')), '')
  )
  on conflict (legacy_file_purpose, legacy_file_version_id)
  where legacy_file_version_id is not null
  do update set
    label = excluded.label,
    hash = excluded.hash,
    evaluation_prompt = excluded.evaluation_prompt,
    evaluation_prompt_version = excluded.evaluation_prompt_version,
    evaluation_character = excluded.evaluation_character,
    evaluation_opening_sentence = excluded.evaluation_opening_sentence,
    is_active = excluded.is_active
  returning * into inserted;

  return inserted;
end;
$$;

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
  p_evaluation_opening_sentence text default null
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
drop function if exists public.deactivate_realtime_prompt_versions();

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
    p_created_by
  );

  select *
  into result
  from public.realtime_prompt_versions
  where id = saved.id;

  return result;
end;
$$;

create or replace function public.deactivate_realtime_prompt_versions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.clear_active_prompt_versions('practice', null);
end;
$$;

revoke all on function public.clear_active_prompt_versions(text, text) from public;
revoke all on function public.activate_prompt_version(uuid, text) from public;
revoke all on function public.delete_prompt_version(uuid, text) from public;
revoke all on function public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid
) from public;
revoke all on function public.save_evaluation_prompt_version(
  text, text, text, text, text, text, text, uuid, text, text
) from public;
revoke all on function public.import_prompt_version(
  text, text, text, timestamptz, boolean, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text
) from public;
revoke all on function public.activate_realtime_prompt_version(
  text, text, text, text, text, text, text, uuid
) from public;
revoke all on function public.deactivate_realtime_prompt_versions() from public;

grant execute on function public.clear_active_prompt_versions(text, text) to authenticated, service_role;
grant execute on function public.activate_prompt_version(uuid, text) to authenticated, service_role;
grant execute on function public.delete_prompt_version(uuid, text) to authenticated, service_role;
grant execute on function public.save_practice_prompt_version(
  text, text, text, text, text, text, text, text, text, uuid
) to authenticated, service_role;
grant execute on function public.save_evaluation_prompt_version(
  text, text, text, text, text, text, text, uuid, text, text
) to authenticated, service_role;
grant execute on function public.import_prompt_version(
  text, text, text, timestamptz, boolean, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated, service_role;
grant execute on function public.activate_realtime_prompt_version(
  text, text, text, text, text, text, text, uuid
) to authenticated, service_role;
grant execute on function public.deactivate_realtime_prompt_versions() to authenticated, service_role;
