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

comment on function public.generate_student_access_code() is 'Generates a 4-character lowercase alphanumeric code containing at least one letter and one digit.';
