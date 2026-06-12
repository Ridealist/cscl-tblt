create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_number text not null unique,
  name text not null,
  english_name text,
  class_number integer not null check (class_number > 0),
  roll_number integer not null check (roll_number > 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists students_class_number_idx
on public.students (class_number);

create table if not exists public.student_access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  class_number integer check (class_number > 0),
  label text,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists student_access_codes_active_class_number_idx
on public.student_access_codes (active, class_number);

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
before update on public.students
for each row execute function public.set_updated_at();

drop trigger if exists student_access_codes_set_updated_at on public.student_access_codes;
create trigger student_access_codes_set_updated_at
before update on public.student_access_codes
for each row execute function public.set_updated_at();

alter table public.students enable row level security;
alter table public.student_access_codes enable row level security;

drop policy if exists "Admins can read students" on public.students;
create policy "Admins can read students"
on public.students
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can insert students" on public.students;
create policy "Admins can insert students"
on public.students
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can update students" on public.students;
create policy "Admins can update students"
on public.students
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can delete students" on public.students;
create policy "Admins can delete students"
on public.students
for delete
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can read student access codes" on public.student_access_codes;
create policy "Admins can read student access codes"
on public.student_access_codes
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins can insert student access codes" on public.student_access_codes;
create policy "Admins can insert student access codes"
on public.student_access_codes
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can update student access codes" on public.student_access_codes;
create policy "Admins can update student access codes"
on public.student_access_codes
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can delete student access codes" on public.student_access_codes;
create policy "Admins can delete student access codes"
on public.student_access_codes
for delete
to authenticated
using (public.is_admin(auth.uid()));

grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.student_access_codes to authenticated;
grant select, insert, update, delete on public.students to service_role;
grant select, insert, update, delete on public.student_access_codes to service_role;

comment on table public.students is 'Student roster used by the classroom login flow.';
comment on table public.student_access_codes is 'Hashed access codes that authorize students to enter class sessions.';
comment on column public.student_access_codes.code_hash is 'Lowercase SHA-256 hex digest of the trimmed access code.';
