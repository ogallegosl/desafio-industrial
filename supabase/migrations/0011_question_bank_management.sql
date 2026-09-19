-- 0011_question_bank_management.sql
-- Question-bank enhancements for reusable cases and integrity.

alter table public.preguntas
  add column if not exists parent_question_id uuid references public.preguntas(id) on delete cascade,
  add column if not exists case_position integer;

alter table public.preguntas drop constraint if exists preguntas_case_position_positive;
alter table public.preguntas add constraint preguntas_case_position_positive
  check (case_position is null or case_position > 0);

create index if not exists preguntas_bank_parent_idx on public.preguntas(bank_id, parent_question_id, is_active);
create index if not exists preguntas_taxonomy_idx on public.preguntas(bank_id, unit, topic, subtopic, difficulty, type);
create unique index if not exists preguntas_case_position_unique
  on public.preguntas(parent_question_id, case_position)
  where parent_question_id is not null and case_position is not null;

create or replace function private.validate_question_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_parent public.preguntas%rowtype;
begin
  if new.parent_question_id is null then
    new.case_position := null;
    return new;
  end if;

  if new.parent_question_id = new.id then
    raise exception 'Una pregunta no puede ser su propio caso padre.';
  end if;

  select * into v_parent from public.preguntas where id = new.parent_question_id;
  if not found then raise exception 'El caso padre no existe.'; end if;
  if v_parent.type <> 'case_group'::public.question_type then raise exception 'La pregunta padre debe ser de tipo case_group.'; end if;
  if v_parent.parent_question_id is not null then raise exception 'No se permiten casos anidados.'; end if;
  if v_parent.bank_id <> new.bank_id then raise exception 'El caso y sus subpreguntas deben pertenecer al mismo banco.'; end if;
  if new.type = 'case_group'::public.question_type then raise exception 'Un caso no puede contener otro caso.'; end if;
  if new.case_position is null then raise exception 'Las subpreguntas requieren una posición.'; end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_question_hierarchy on public.preguntas;
create trigger trg_validate_question_hierarchy
before insert or update of parent_question_id, bank_id, type, case_position
on public.preguntas
for each row execute function private.validate_question_hierarchy();

create or replace function private.validate_alternative_question_type()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_type public.question_type;
begin
  select type into v_type from public.preguntas where id = new.question_id;
  if v_type not in ('single_choice'::public.question_type,'multiple_choice'::public.question_type,'image_single_choice'::public.question_type) then
    raise exception 'Este tipo de pregunta no admite alternativas almacenadas.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_alternative_question_type on public.alternativas;
create trigger trg_validate_alternative_question_type
before insert or update of question_id on public.alternativas
for each row execute function private.validate_alternative_question_type();

-- Avoid silently moving a populated bank to another course, which could invalidate
-- exam/question relationships already created in the original course.
create or replace function private.prevent_populated_bank_course_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.course_id is distinct from old.course_id
     and exists (select 1 from public.preguntas q where q.bank_id = old.id) then
    raise exception 'No se puede cambiar de curso un banco que ya contiene preguntas.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_populated_bank_course_change on public.bancos_preguntas;
create trigger trg_prevent_populated_bank_course_change
before update of course_id on public.bancos_preguntas
for each row execute function private.prevent_populated_bank_course_change();

-- A question already incorporated into an exam must not be moved to another bank,
-- because the target bank may belong to a different course.
create or replace function private.prevent_used_question_bank_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.bank_id is distinct from old.bank_id
     and (
       exists (select 1 from public.preguntas_examen pe where pe.question_id = old.id)
       or exists (select 1 from public.intento_preguntas ip where ip.question_id = old.id)
     ) then
    raise exception 'No se puede mover de banco una pregunta que ya está vinculada a un examen.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_used_question_bank_change on public.preguntas;
create trigger trg_prevent_used_question_bank_change
before update of bank_id on public.preguntas
for each row execute function private.prevent_used_question_bank_change();
