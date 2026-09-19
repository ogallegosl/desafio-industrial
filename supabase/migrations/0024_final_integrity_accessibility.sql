-- 0024_final_integrity_accessibility.sql
-- Prompt 21 final audit: transactional exam writes and identity consistency.

-- The public access flow always requires a stable student identifier. Align the
-- persisted exam configuration with that rule so the teacher cannot save an
-- impossible combination (both student code and email disabled).
update public.configuraciones_examen
set require_student_code = true
where require_student_code = false
  and require_email = false;

do $$ begin
  alter table public.configuraciones_examen
    add constraint config_student_identifier_required
    check (require_student_code or require_email);
exception when duplicate_object then null; end $$;

-- Create exam + configuration + optional access code as one PostgreSQL
-- transaction. SECURITY INVOKER intentionally preserves RLS and caller rights.
create or replace function public.create_exam_bundle(
  p_exam jsonb,
  p_config jsonb,
  p_access_code text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_course_id uuid;
  v_title text;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_course_id := nullif(btrim(coalesce(p_exam->>'courseId', '')), '')::uuid;
  v_title := btrim(coalesce(p_exam->>'title', ''));
  if v_course_id is null then raise exception 'Course is required'; end if;
  if v_title = '' then raise exception 'Exam title is required'; end if;

  insert into public.examenes (
    course_id, owner_user_id, title, description, instructions,
    starts_at, ends_at, status, is_deleted
  ) values (
    v_course_id,
    auth.uid(),
    v_title,
    nullif(btrim(coalesce(p_exam->>'description', '')), ''),
    nullif(btrim(coalesce(p_exam->>'instructions', '')), ''),
    nullif(p_exam->>'startsAt', '')::timestamptz,
    nullif(p_exam->>'endsAt', '')::timestamptz,
    'draft'::public.exam_status,
    false
  ) returning id into v_exam_id;

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
    passing_grade
  ) values (
    v_exam_id,
    coalesce((p_config->>'duration_minutes')::integer, 60),
    coalesce((p_config->>'max_attempts')::integer, 1),
    coalesce((p_config->>'target_question_count')::integer, 20),
    coalesce((p_config->>'randomize_questions')::boolean, true),
    coalesce((p_config->>'randomize_options')::boolean, true),
    coalesce(nullif(p_config->>'navigation', ''), 'free')::public.navigation_mode,
    coalesce((p_config->>'allow_backtrack')::boolean, true),
    true,
    coalesce(nullif(p_config->>'result_visibility', ''), 'confirmation_only')::public.result_visibility,
    nullif(p_config->>'show_results_after', '')::timestamptz,
    coalesce((p_config->>'require_student_code')::boolean, true),
    coalesce((p_config->>'require_first_name')::boolean, true),
    coalesce((p_config->>'require_last_name')::boolean, true),
    coalesce((p_config->>'require_email')::boolean, false),
    coalesce((p_config->>'require_section')::boolean, false),
    coalesce((p_config->>'restrict_to_enrolled_students')::boolean, false),
    coalesce((p_config->>'grade_scale_max')::numeric, 20),
    coalesce((p_config->>'passing_grade')::numeric, 10.5)
  );

  v_code := btrim(coalesce(p_access_code, ''));
  if v_code <> '' then
    perform public.set_exam_access_code(v_exam_id, v_code);
  end if;

  return v_exam_id;
end;
$$;

-- Update exam + configuration + access code as one PostgreSQL transaction.
create or replace function public.update_exam_bundle(
  p_exam_id uuid,
  p_exam jsonb,
  p_config jsonb,
  p_access_code text default null,
  p_clear_access_code boolean default false
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_changed integer;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.examenes
  set course_id = nullif(btrim(coalesce(p_exam->>'courseId', '')), '')::uuid,
      title = btrim(coalesce(p_exam->>'title', '')),
      description = nullif(btrim(coalesce(p_exam->>'description', '')), ''),
      instructions = nullif(btrim(coalesce(p_exam->>'instructions', '')), ''),
      starts_at = nullif(p_exam->>'startsAt', '')::timestamptz,
      ends_at = nullif(p_exam->>'endsAt', '')::timestamptz,
      updated_at = now()
  where id = p_exam_id
    and is_deleted = false;

  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'Exam not found or not accessible';
  end if;

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
    passing_grade
  ) values (
    p_exam_id,
    coalesce((p_config->>'duration_minutes')::integer, 60),
    coalesce((p_config->>'max_attempts')::integer, 1),
    coalesce((p_config->>'target_question_count')::integer, 20),
    coalesce((p_config->>'randomize_questions')::boolean, true),
    coalesce((p_config->>'randomize_options')::boolean, true),
    coalesce(nullif(p_config->>'navigation', ''), 'free')::public.navigation_mode,
    coalesce((p_config->>'allow_backtrack')::boolean, true),
    true,
    coalesce(nullif(p_config->>'result_visibility', ''), 'confirmation_only')::public.result_visibility,
    nullif(p_config->>'show_results_after', '')::timestamptz,
    coalesce((p_config->>'require_student_code')::boolean, true),
    coalesce((p_config->>'require_first_name')::boolean, true),
    coalesce((p_config->>'require_last_name')::boolean, true),
    coalesce((p_config->>'require_email')::boolean, false),
    coalesce((p_config->>'require_section')::boolean, false),
    coalesce((p_config->>'restrict_to_enrolled_students')::boolean, false),
    coalesce((p_config->>'grade_scale_max')::numeric, 20),
    coalesce((p_config->>'passing_grade')::numeric, 10.5)
  )
  on conflict (exam_id) do update set
    duration_minutes = excluded.duration_minutes,
    max_attempts = excluded.max_attempts,
    target_question_count = excluded.target_question_count,
    randomize_questions = excluded.randomize_questions,
    randomize_options = excluded.randomize_options,
    navigation = excluded.navigation,
    allow_backtrack = excluded.allow_backtrack,
    auto_submit_on_timeout = excluded.auto_submit_on_timeout,
    result_visibility = excluded.result_visibility,
    show_results_after = excluded.show_results_after,
    require_student_code = excluded.require_student_code,
    require_first_name = excluded.require_first_name,
    require_last_name = excluded.require_last_name,
    require_email = excluded.require_email,
    require_section = excluded.require_section,
    restrict_to_enrolled_students = excluded.restrict_to_enrolled_students,
    grade_scale_max = excluded.grade_scale_max,
    passing_grade = excluded.passing_grade,
    updated_at = now();

  if coalesce(p_clear_access_code, false) then
    perform public.clear_exam_access_code(p_exam_id);
  else
    v_code := btrim(coalesce(p_access_code, ''));
    if v_code <> '' then
      perform public.set_exam_access_code(p_exam_id, v_code);
    end if;
  end if;
end;
$$;

revoke all on function public.create_exam_bundle(jsonb, jsonb, text) from public, anon;
revoke all on function public.update_exam_bundle(uuid, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function public.create_exam_bundle(jsonb, jsonb, text) to authenticated;
grant execute on function public.update_exam_bundle(uuid, jsonb, jsonb, text, boolean) to authenticated;

-- Prevent a course change after an exam has acquired question-plan or attempt
-- history. Otherwise fixed questions/rules from the previous course could remain
-- attached to an exam that now claims to belong to another course.
create or replace function public.prevent_exam_course_change_with_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.course_id is distinct from old.course_id and (
    exists (select 1 from public.preguntas_examen pe where pe.exam_id = old.id)
    or exists (select 1 from public.reglas_seleccion_examen rs where rs.exam_id = old.id)
    or exists (select 1 from public.intentos i where i.exam_id = old.id)
  ) then
    raise exception 'No se puede cambiar de curso un examen que ya tiene preguntas, reglas de selección o intentos.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_exam_course_change_with_history on public.examenes;
create trigger trg_prevent_exam_course_change_with_history
before update of course_id on public.examenes
for each row execute function public.prevent_exam_course_change_with_history();
