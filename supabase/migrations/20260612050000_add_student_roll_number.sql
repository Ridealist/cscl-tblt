alter table public.students
add column if not exists roll_number integer;

with numbered_students as (
  select
    id,
    row_number() over (
      partition by class_number
      order by student_number
    ) as generated_roll_number
  from public.students
  where roll_number is null
)
update public.students students
set roll_number = numbered_students.generated_roll_number
from numbered_students
where students.id = numbered_students.id;

alter table public.students
alter column roll_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'students_roll_number_check'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
    add constraint students_roll_number_check check (roll_number > 0);
  end if;
end;
$$;
