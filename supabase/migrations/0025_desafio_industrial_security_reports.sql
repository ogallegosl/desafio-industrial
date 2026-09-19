-- 0025_desafio_industrial_security_reports.sql
-- Desafío Industrial: fixed name-only student identity, browser-security settings,
-- lighter evidence limits and persisted platform branding.

-- Global branding defaults. Preserve a custom installation if the administrator
-- already replaced these values.
update public.configuracion_global
set institution_name = case when institution_name in ('Institución educativa', 'Universidad Nacional de San Agustín de Arequipa') then 'Universidad Nacional de San Agustín de Arequipa' else institution_name end,
    platform_name = case when platform_name in ('EvaluaLab', 'Desafío Industrial') then 'Desafío Industrial' else platform_name end,
    platform_subtitle = case when platform_subtitle in ('Ingeniería Industrial', 'Ingeniería Industrial UNSA', '') then 'Ingeniería Industrial UNSA' else platform_subtitle end,
    evidence_max_bytes = least(evidence_max_bytes, 5 * 1024 * 1024),
    updated_at = now()
where id = 1;

-- Student access is intentionally simplified to surnames + given names.
update public.configuraciones_examen
set require_student_code = false,
    require_first_name = true,
    require_last_name = true,
    require_email = false,
    require_section = false,
    settings = jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{security}',
      coalesce(settings->'security', '{"enabled":true,"requireFullscreen":true,"detectVisibility":true,"detectBlur":true,"blockClipboard":true,"blockContextMenu":true,"blockShortcuts":true,"watermark":true,"detectExtendedDisplay":true,"requireSeb":false,"maxIncidents":3}'::jsonb),
      true
    ),
    updated_at = now();

alter table public.configuraciones_examen drop constraint if exists config_student_identifier_required;
alter table public.configuraciones_examen drop constraint if exists config_student_name_only_identity;
alter table public.configuraciones_examen
  add constraint config_student_name_only_identity check (
    require_student_code = false
    and require_first_name = true
    and require_last_name = true
    and require_email = false
    and require_section = false
  );

-- Keep storage limits aligned with the client-side photo compressor.
update storage.buckets
set file_size_limit = 5 * 1024 * 1024
where id = 'student-evidence';

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
  v_settings jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_course_id := nullif(btrim(coalesce(p_exam->>'courseId', '')), '')::uuid;
  v_title := btrim(coalesce(p_exam->>'title', ''));
  if v_course_id is null then raise exception 'Course is required'; end if;
  if v_title = '' then raise exception 'Exam title is required'; end if;
  v_settings := coalesce(p_config->'settings', '{}'::jsonb);
  if not (v_settings ? 'security') then
    v_settings := jsonb_set(v_settings, '{security}', '{"enabled":true,"requireFullscreen":true,"detectVisibility":true,"detectBlur":true,"blockClipboard":true,"blockContextMenu":true,"blockShortcuts":true,"watermark":true,"detectExtendedDisplay":true,"requireSeb":false,"maxIncidents":3}'::jsonb, true);
  end if;

  insert into public.examenes (course_id, owner_user_id, title, description, instructions, starts_at, ends_at, status, is_deleted)
  values (
    v_course_id, auth.uid(), v_title,
    nullif(btrim(coalesce(p_exam->>'description', '')), ''),
    nullif(btrim(coalesce(p_exam->>'instructions', '')), ''),
    nullif(p_exam->>'startsAt', '')::timestamptz,
    nullif(p_exam->>'endsAt', '')::timestamptz,
    'draft'::public.exam_status, false
  ) returning id into v_exam_id;

  insert into public.configuraciones_examen (
    exam_id, duration_minutes, max_attempts, target_question_count, randomize_questions,
    randomize_options, navigation, allow_backtrack, auto_submit_on_timeout,
    result_visibility, show_results_after, require_student_code, require_first_name,
    require_last_name, require_email, require_section, restrict_to_enrolled_students,
    grade_scale_max, passing_grade, settings
  ) values (
    v_exam_id,
    coalesce((p_config->>'duration_minutes')::integer, 60),
    coalesce((p_config->>'max_attempts')::integer, 1),
    coalesce((p_config->>'target_question_count')::integer, 20),
    coalesce((p_config->>'randomize_questions')::boolean, true),
    coalesce((p_config->>'randomize_options')::boolean, true),
    coalesce(nullif(p_config->>'navigation', ''), 'free')::public.navigation_mode,
    coalesce((p_config->>'allow_backtrack')::boolean, true), true,
    coalesce(nullif(p_config->>'result_visibility', ''), 'confirmation_only')::public.result_visibility,
    nullif(p_config->>'show_results_after', '')::timestamptz,
    false, true, true, false, false,
    coalesce((p_config->>'restrict_to_enrolled_students')::boolean, false),
    coalesce((p_config->>'grade_scale_max')::numeric, 20),
    coalesce((p_config->>'passing_grade')::numeric, 10.5),
    v_settings
  );

  v_code := btrim(coalesce(p_access_code, ''));
  if v_code <> '' then perform public.set_exam_access_code(v_exam_id, v_code); end if;
  return v_exam_id;
end;
$$;

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
  v_settings jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_settings := coalesce(p_config->'settings', '{}'::jsonb);
  if not (v_settings ? 'security') then
    v_settings := jsonb_set(v_settings, '{security}', '{"enabled":true,"requireFullscreen":true,"detectVisibility":true,"detectBlur":true,"blockClipboard":true,"blockContextMenu":true,"blockShortcuts":true,"watermark":true,"detectExtendedDisplay":true,"requireSeb":false,"maxIncidents":3}'::jsonb, true);
  end if;

  update public.examenes
  set course_id = nullif(btrim(coalesce(p_exam->>'courseId', '')), '')::uuid,
      title = btrim(coalesce(p_exam->>'title', '')),
      description = nullif(btrim(coalesce(p_exam->>'description', '')), ''),
      instructions = nullif(btrim(coalesce(p_exam->>'instructions', '')), ''),
      starts_at = nullif(p_exam->>'startsAt', '')::timestamptz,
      ends_at = nullif(p_exam->>'endsAt', '')::timestamptz,
      updated_at = now()
  where id = p_exam_id and is_deleted = false;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'Exam not found or not accessible'; end if;

  insert into public.configuraciones_examen (
    exam_id, duration_minutes, max_attempts, target_question_count, randomize_questions,
    randomize_options, navigation, allow_backtrack, auto_submit_on_timeout,
    result_visibility, show_results_after, require_student_code, require_first_name,
    require_last_name, require_email, require_section, restrict_to_enrolled_students,
    grade_scale_max, passing_grade, settings
  ) values (
    p_exam_id,
    coalesce((p_config->>'duration_minutes')::integer, 60),
    coalesce((p_config->>'max_attempts')::integer, 1),
    coalesce((p_config->>'target_question_count')::integer, 20),
    coalesce((p_config->>'randomize_questions')::boolean, true),
    coalesce((p_config->>'randomize_options')::boolean, true),
    coalesce(nullif(p_config->>'navigation', ''), 'free')::public.navigation_mode,
    coalesce((p_config->>'allow_backtrack')::boolean, true), true,
    coalesce(nullif(p_config->>'result_visibility', ''), 'confirmation_only')::public.result_visibility,
    nullif(p_config->>'show_results_after', '')::timestamptz,
    false, true, true, false, false,
    coalesce((p_config->>'restrict_to_enrolled_students')::boolean, false),
    coalesce((p_config->>'grade_scale_max')::numeric, 20),
    coalesce((p_config->>'passing_grade')::numeric, 10.5),
    v_settings
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
    require_student_code = false,
    require_first_name = true,
    require_last_name = true,
    require_email = false,
    require_section = false,
    restrict_to_enrolled_students = excluded.restrict_to_enrolled_students,
    grade_scale_max = excluded.grade_scale_max,
    passing_grade = excluded.passing_grade,
    settings = excluded.settings,
    updated_at = now();

  if coalesce(p_clear_access_code, false) then
    perform public.clear_exam_access_code(p_exam_id);
  else
    v_code := btrim(coalesce(p_access_code, ''));
    if v_code <> '' then perform public.set_exam_access_code(p_exam_id, v_code); end if;
  end if;
end;
$$;

revoke all on function public.create_exam_bundle(jsonb, jsonb, text) from public, anon;
revoke all on function public.update_exam_bundle(uuid, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function public.create_exam_bundle(jsonb, jsonb, text) to authenticated;
grant execute on function public.update_exam_bundle(uuid, jsonb, jsonb, text, boolean) to authenticated;
