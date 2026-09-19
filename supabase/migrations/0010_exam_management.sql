-- 0010_exam_management.sql
-- Prompt 04: teacher exam lifecycle, target question count and safe duplication.

alter table public.configuraciones_examen
  add column if not exists target_question_count integer not null default 20;

do $$ begin
  alter table public.configuraciones_examen
    add constraint config_target_question_count_positive check (target_question_count > 0);
exception when duplicate_object then null; end $$;

-- Prevent incomplete exams from being published. Draft/closed/archived exams remain editable.
create or replace function public.validate_exam_publishable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cfg public.configuraciones_examen%rowtype;
begin
  if new.status in ('scheduled', 'active') then
    if new.is_deleted then
      raise exception 'A deleted exam cannot be scheduled or activated';
    end if;

    if new.access_code_hash is null or new.access_code_lookup is null then
      raise exception 'Configure an access code before scheduling or activating the exam';
    end if;

    if new.starts_at is null or new.ends_at is null then
      raise exception 'Configure a start and end date before scheduling or activating the exam';
    end if;

    if new.ends_at <= new.starts_at then
      raise exception 'The exam end date must be later than the start date';
    end if;

    if new.ends_at <= now() then
      raise exception 'The exam end date must be in the future';
    end if;

    select * into cfg
    from public.configuraciones_examen
    where exam_id = new.id;

    if not found then
      raise exception 'The exam does not have a configuration';
    end if;

    if cfg.duration_minutes <= 0 then
      raise exception 'The exam duration must be greater than zero';
    end if;

    if cfg.target_question_count <= 0 then
      raise exception 'The target question count must be greater than zero';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_exam_publishable on public.examenes;
create trigger trg_validate_exam_publishable
before insert or update on public.examenes
for each row execute function public.validate_exam_publishable();

-- Duplicate an exam atomically. Access code, schedule, attempts and results are intentionally not copied.
create or replace function public.duplicate_exam(p_exam_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  src public.examenes%rowtype;
  new_exam_id uuid;
begin
  select * into src
  from public.examenes
  where id = p_exam_id
    and is_deleted = false;

  if not found then
    raise exception 'Exam not found or not accessible';
  end if;

  insert into public.examenes (
    course_id,
    owner_user_id,
    title,
    description,
    instructions,
    access_code_hash,
    access_code_lookup,
    access_code_hint,
    starts_at,
    ends_at,
    status,
    is_deleted
  ) values (
    src.course_id,
    auth.uid(),
    src.title || ' (copia)',
    src.description,
    src.instructions,
    null,
    null,
    null,
    null,
    null,
    'draft',
    false
  )
  returning id into new_exam_id;

  insert into public.configuraciones_examen (
    exam_id,
    duration_minutes,
    max_attempts,
    target_question_count,
    randomize_questions,
    randomize_options,
    navigation,
    allow_backtrack,
    auto_submit_on_timeout,
    result_visibility,
    show_results_after,
    require_student_code,
    require_first_name,
    require_last_name,
    require_email,
    require_section,
    restrict_to_enrolled_students,
    grade_scale_max,
    passing_grade,
    settings
  )
  select
    new_exam_id,
    duration_minutes,
    max_attempts,
    target_question_count,
    randomize_questions,
    randomize_options,
    navigation,
    allow_backtrack,
    auto_submit_on_timeout,
    result_visibility,
    null,
    require_student_code,
    require_first_name,
    require_last_name,
    require_email,
    require_section,
    restrict_to_enrolled_students,
    grade_scale_max,
    passing_grade,
    settings
  from public.configuraciones_examen
  where exam_id = p_exam_id;

  insert into public.preguntas_examen (
    exam_id, question_id, fixed_position, points_override, is_required
  )
  select
    new_exam_id, question_id, fixed_position, points_override, is_required
  from public.preguntas_examen
  where exam_id = p_exam_id;

  insert into public.reglas_seleccion_examen (
    exam_id,
    bank_id,
    unit,
    topic,
    subtopic,
    difficulty,
    question_type,
    quantity,
    rule_order,
    points_override,
    metadata
  )
  select
    new_exam_id,
    bank_id,
    unit,
    topic,
    subtopic,
    difficulty,
    question_type,
    quantity,
    rule_order,
    points_override,
    metadata
  from public.reglas_seleccion_examen
  where exam_id = p_exam_id;

  return new_exam_id;
end;
$$;

revoke all on function public.duplicate_exam(uuid) from public, anon;
grant execute on function public.duplicate_exam(uuid) to authenticated;
