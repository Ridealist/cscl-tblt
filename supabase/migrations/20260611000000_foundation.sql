create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'student')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = check_user_id
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

create table if not exists public.app_settings (
  id text primary key default 'default',
  num_classes integer not null default 4 check (num_classes > 0),
  num_groups_per_class integer not null default 4 check (num_groups_per_class > 0),
  class_start integer not null default 1 check (class_start > 0),
  active_class integer not null default 1 check (active_class > 0),
  agent_mode text not null default 'pipeline' check (agent_mode in ('pipeline', 'realtime')),
  agent_role text not null default 'dominant' check (agent_role in ('dominant', 'collaborative')),
  feedback_condition_id text not null default 'no_corrective',
  realtime_resetting boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.app_settings (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.realtime_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  base_prompt text not null,
  dominant_prompt text not null,
  collaborative_prompt text not null,
  feedback_condition_id text not null,
  feedback_prompt text not null,
  task_card_id text not null,
  task_card_prompt text not null,
  source text not null default 'custom' check (source in ('custom')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create unique index if not exists realtime_prompt_versions_one_active
on public.realtime_prompt_versions (is_active)
where is_active = true;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.realtime_prompt_versions enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admins can read profiles" on public.profiles;
create policy "Admins can read profiles"
on public.profiles
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can insert profiles" on public.profiles;
create policy "Admins can insert profiles"
on public.profiles
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles"
on public.profiles
for delete
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can read app settings" on public.app_settings;
create policy "Admins can read app settings"
on public.app_settings
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can insert app settings" on public.app_settings;
create policy "Admins can insert app settings"
on public.app_settings
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can update app settings" on public.app_settings;
create policy "Admins can update app settings"
on public.app_settings
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can read realtime prompt versions" on public.realtime_prompt_versions;
create policy "Admins can read realtime prompt versions"
on public.realtime_prompt_versions
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can insert realtime prompt versions" on public.realtime_prompt_versions;
create policy "Admins can insert realtime prompt versions"
on public.realtime_prompt_versions
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can update realtime prompt versions" on public.realtime_prompt_versions;
create policy "Admins can update realtime prompt versions"
on public.realtime_prompt_versions
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

comment on table public.profiles is 'Supabase Auth profile and app role metadata. Bootstrap the first admin through SQL or the Supabase dashboard.';
comment on table public.app_settings is 'Persistent replacement target for config.json.';
comment on table public.realtime_prompt_versions is 'Versioned replacement target for prompt_config.json realtime overrides.';
comment on column public.realtime_prompt_versions.task_card_prompt is 'Snapshot of the resolved task card prompt for the saved version.';

-- Deferred to #36:
--   public.class_sessions
--   public.conversation_events
