alter table public.students
add column if not exists access_code text;

create or replace function public.generate_student_access_code()
returns text
language plpgsql
volatile
as $$
declare
  chars constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  candidate text;
  i integer;
begin
  loop
    candidate := '';
    for i in 1..4 loop
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::integer, 1);
    end loop;

    if candidate ~ '[a-z]' and candidate ~ '[0-9]' then
      return candidate;
    end if;
  end loop;
end;
$$;

create or replace function public.generate_unique_student_access_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  candidate text;
  attempts integer := 0;
begin
  loop
    candidate := public.generate_student_access_code();
    exit when not exists (
      select 1
      from public.students
      where access_code = candidate
    );

    attempts := attempts + 1;
    if attempts >= 100 then
      raise exception 'Unable to generate a unique student access code after % attempts', attempts;
    end if;
  end loop;

  return candidate;
end;
$$;

create or replace function public.set_student_access_code()
returns trigger
language plpgsql
as $$
begin
  if new.access_code is null or btrim(new.access_code) = '' then
    new.access_code := public.generate_unique_student_access_code();
  else
    new.access_code := lower(btrim(new.access_code));
  end if;

  return new;
end;
$$;

drop trigger if exists students_set_access_code on public.students;
create trigger students_set_access_code
before insert on public.students
for each row execute function public.set_student_access_code();

do $$
declare
  student_row record;
begin
  for student_row in
    select id
    from public.students
    where access_code is null or btrim(access_code) = ''
  loop
    update public.students
    set access_code = public.generate_unique_student_access_code()
    where id = student_row.id;
  end loop;
end;
$$;

alter table public.students
alter column access_code set not null;

alter table public.students
drop constraint if exists students_access_code_format_check;
alter table public.students
add constraint students_access_code_format_check
check (
  access_code ~ '^[a-z0-9]{4}$'
  and access_code ~ '[a-z]'
  and access_code ~ '[0-9]'
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'students_access_code_unique'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
    add constraint students_access_code_unique unique (access_code);
  end if;
end;
$$;

drop table if exists public.student_access_code;
drop table if exists public.student_access_codes;

comment on column public.students.access_code is 'Plain 4-character lowercase alphanumeric student entry code, generated automatically when omitted.';
comment on function public.generate_student_access_code() is 'Generates a 4-character lowercase alphanumeric code containing at least one letter and one digit.';
comment on function public.generate_unique_student_access_code() is 'Generates a student access code that does not currently exist in public.students.';
