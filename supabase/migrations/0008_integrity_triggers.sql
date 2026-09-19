-- 0008_integrity_triggers.sql
-- Cross-table consistency checks that cannot be expressed with simple CHECK constraints.

create or replace function public.validate_response_attempt_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_attempt uuid;
begin
  select iq.attempt_id
    into expected_attempt
  from public.intento_preguntas iq
  where iq.id = new.attempt_question_id;

  if expected_attempt is null then
    raise exception 'attempt_question_id does not exist';
  end if;

  if new.attempt_id <> expected_attempt then
    raise exception 'response attempt_id does not match attempt_question attempt_id';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_response_attempt_consistency on public.respuestas;
create trigger trg_response_attempt_consistency
before insert or update of attempt_question_id, attempt_id
on public.respuestas
for each row execute function public.validate_response_attempt_consistency();

create or replace function public.validate_evidence_attempt_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_attempt uuid;
begin
  select r.attempt_id
    into expected_attempt
  from public.respuestas r
  where r.id = new.response_id;

  if expected_attempt is null then
    raise exception 'response_id does not exist';
  end if;

  if new.attempt_id <> expected_attempt then
    raise exception 'evidence attempt_id does not match response attempt_id';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_evidence_attempt_consistency on public.evidencias;
create trigger trg_evidence_attempt_consistency
before insert or update of response_id, attempt_id
on public.evidencias
for each row execute function public.validate_evidence_attempt_consistency();

create or replace function public.prevent_attempt_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.exam_id <> old.exam_id
     or new.student_id <> old.student_id
     or new.attempt_number <> old.attempt_number then
    raise exception 'exam_id, student_id and attempt_number are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_attempt_identity_change on public.intentos;
create trigger trg_prevent_attempt_identity_change
before update on public.intentos
for each row execute function public.prevent_attempt_identity_change();
