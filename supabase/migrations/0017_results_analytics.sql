-- 0017_results_analytics.sql
-- Prompt 12: server-side exam, question and student analytics.

create index if not exists idx_calificaciones_final_grade
  on public.calificaciones(attempt_id, final_grade)
  where final_grade is not null;

create index if not exists idx_respuestas_question_result
  on public.respuestas(attempt_question_id, is_answered, is_correct, review_status);

-- Overview metrics for one exam. Participants are unique students; grade
-- distribution metrics use closed attempts with a final grade available.
create or replace function public.get_exam_overview(p_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.owns_exam(p_exam_id) then raise exception 'FORBIDDEN'; end if;

  with cfg as (
    select grade_scale_max, passing_grade
    from public.configuraciones_examen
    where exam_id = p_exam_id
  ),
  attempts as (
    select i.*
    from public.intentos i
    where i.exam_id = p_exam_id
      and i.status <> 'cancelled'::public.attempt_status
  ),
  closed as (
    select *
    from attempts
    where status in ('submitted'::public.attempt_status, 'time_expired'::public.attempt_status)
  ),
  graded as (
    select c.final_grade
    from public.calificaciones c
    join closed i on i.id = c.attempt_id
    where c.final_grade is not null
  ),
  times as (
    select extract(epoch from (coalesce(i.submitted_at, i.deadline_at) - i.started_at)) as seconds
    from closed i
    where i.started_at is not null
      and coalesce(i.submitted_at, i.deadline_at) is not null
      and coalesce(i.submitted_at, i.deadline_at) >= i.started_at
  ),
  pending as (
    select count(*)::integer as total
    from public.respuestas r
    join attempts i on i.id = r.attempt_id
    where r.review_status = 'pending'::public.review_status
  )
  select jsonb_build_object(
    'participants', (select count(distinct student_id) from attempts),
    'attempts', (select count(*) from attempts),
    'closedAttempts', (select count(*) from closed),
    'submitted', (select count(*) from closed where status = 'submitted'::public.attempt_status),
    'timeExpired', (select count(*) from closed where status = 'time_expired'::public.attempt_status),
    'inProgress', (select count(*) from attempts where status = 'in_progress'::public.attempt_status),
    'created', (select count(*) from attempts where status = 'created'::public.attempt_status),
    'pendingManualReviews', (select total from pending),
    'gradedAttempts', (select count(*) from graded),
    'averageGrade', (select round(avg(final_grade), 3) from graded),
    'medianGrade', (select round((percentile_cont(0.5) within group (order by final_grade))::numeric, 3) from graded),
    'minGrade', (select min(final_grade) from graded),
    'maxGrade', (select max(final_grade) from graded),
    'stddevGrade', (select round(coalesce(stddev_pop(final_grade), 0), 3) from graded),
    'passedAttempts', (
      select count(*)
      from graded g, cfg
      where g.final_grade >= cfg.passing_grade
    ),
    'passRate', (
      select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where g.final_grade >= cfg.passing_grade) / count(*), 2)
      end
      from graded g cross join cfg
    ),
    'averageTimeSeconds', (select round(avg(seconds)) from times),
    'gradeScaleMax', (select grade_scale_max from cfg),
    'passingGrade', (select passing_grade from cfg)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- Item-level analytics. Correct/incorrect/difficulty are only reported for
-- question types with objective correctness. Manual-response items use score
-- performance instead of inventing a correctness classification.
create or replace function public.get_exam_question_analytics(p_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.owns_exam(p_exam_id) then raise exception 'FORBIDDEN'; end if;

  with closed as (
    select id
    from public.intentos
    where exam_id = p_exam_id
      and status in ('submitted'::public.attempt_status, 'time_expired'::public.attempt_status)
  ),
  base as (
    select
      coalesce(q.question_id::text, 'snapshot:' || md5(q.prompt_snapshot || ':' || q.question_type::text)) as question_key,
      q.question_id,
      q.question_type,
      q.prompt_snapshot,
      q.points_snapshot,
      q.display_order,
      r.id as response_id,
      coalesce(r.is_answered, false) as is_answered,
      r.is_correct,
      r.review_status,
      r.auto_score,
      r.manual_score
    from public.intento_preguntas q
    join closed i on i.id = q.attempt_id
    left join public.respuestas r on r.attempt_question_id = q.id
  ),
  grouped as (
    select
      question_key,
      question_id,
      question_type,
      prompt_snapshot,
      min(display_order) as first_display_order,
      count(*)::integer as exposures,
      count(*) filter (where is_answered)::integer as answered,
      count(*) filter (where not is_answered)::integer as omitted,
      count(*) filter (where is_answered and is_correct is true)::integer as correct,
      count(*) filter (where is_answered and is_correct is false)::integer as incorrect,
      count(*) filter (where is_answered and is_correct is null)::integer as manual_answered,
      count(*) filter (where review_status = 'pending'::public.review_status)::integer as pending_manual,
      round(avg(
        case
          when points_snapshot <= 0 or not is_answered or review_status = 'pending'::public.review_status then null
          when review_status = 'reviewed'::public.review_status then 100.0 * coalesce(manual_score, 0) / points_snapshot
          else 100.0 * coalesce(auto_score, 0) / points_snapshot
        end
      ), 2) as average_score_rate,
      bool_or(is_correct is not null) as has_objective_result
    from base
    group by question_key, question_id, question_type, prompt_snapshot
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'questionKey', question_key,
      'questionId', question_id,
      'type', question_type::text,
      'prompt', prompt_snapshot,
      'exposures', exposures,
      'answered', answered,
      'omitted', omitted,
      'correct', correct,
      'incorrect', incorrect,
      'manualAnswered', manual_answered,
      'pendingManual', pending_manual,
      'correctRate', case when has_objective_result and exposures > 0 then round(100.0 * correct / exposures, 2) else null end,
      'difficultyIndex', case when has_objective_result and exposures > 0 then round(100.0 - (100.0 * correct / exposures), 2) else null end,
      'averageScoreRate', average_score_rate
    ) order by first_display_order, prompt_snapshot
  ), '[]'::jsonb)
  into v_result
  from grouped;

  return v_result;
end;
$$;

-- Attempt-level student result rows. Each attempt remains visible so multiple
-- allowed attempts are not silently collapsed into one record.
create or replace function public.get_exam_student_results(p_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.owns_exam(p_exam_id) then raise exception 'FORBIDDEN'; end if;

  with attempt_rows as (
    select
      i.id as attempt_id,
      i.student_id,
      i.attempt_number,
      i.status,
      i.started_at,
      i.submitted_at,
      i.deadline_at,
      s.student_code,
      s.first_name,
      s.last_name,
      s.email,
      s.section,
      c.auto_score,
      c.manual_score,
      c.raw_score,
      c.max_raw_score,
      c.final_grade,
      coalesce(c.pending_manual_reviews, 0) as pending_manual_reviews,
      c.is_published,
      c.graded_at,
      count(q.id)::integer as total_questions,
      count(q.id) filter (where coalesce(r.is_answered, false))::integer as answered,
      count(q.id) filter (where not coalesce(r.is_answered, false))::integer as omitted,
      count(q.id) filter (where coalesce(r.is_answered, false) and r.is_correct is true)::integer as correct,
      count(q.id) filter (where coalesce(r.is_answered, false) and r.is_correct is false)::integer as incorrect,
      count(q.id) filter (where coalesce(r.is_answered, false) and r.is_correct is null)::integer as manual_answered
    from public.intentos i
    join public.estudiantes s on s.id = i.student_id
    left join public.calificaciones c on c.attempt_id = i.id
    left join public.intento_preguntas q on q.attempt_id = i.id
    left join public.respuestas r on r.attempt_question_id = q.id
    where i.exam_id = p_exam_id
      and i.status <> 'cancelled'::public.attempt_status
    group by
      i.id, i.student_id, i.attempt_number, i.status, i.started_at, i.submitted_at, i.deadline_at,
      s.student_code, s.first_name, s.last_name, s.email, s.section,
      c.auto_score, c.manual_score, c.raw_score, c.max_raw_score, c.final_grade,
      c.pending_manual_reviews, c.is_published, c.graded_at
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'attemptId', attempt_id,
      'studentId', student_id,
      'studentCode', student_code,
      'firstName', first_name,
      'lastName', last_name,
      'email', email,
      'section', section,
      'attemptNumber', attempt_number,
      'status', status::text,
      'startedAt', started_at,
      'submittedAt', submitted_at,
      'deadlineAt', deadline_at,
      'elapsedSeconds', case
        when started_at is null then null
        when coalesce(submitted_at, case when status = 'time_expired'::public.attempt_status then deadline_at else null end) is null then null
        else greatest(0, extract(epoch from (coalesce(submitted_at, deadline_at) - started_at)))::bigint
      end,
      'totalQuestions', total_questions,
      'answered', answered,
      'omitted', omitted,
      'correct', correct,
      'incorrect', incorrect,
      'manualAnswered', manual_answered,
      'autoScore', auto_score,
      'manualScore', manual_score,
      'rawScore', raw_score,
      'maxRawScore', max_raw_score,
      'finalGrade', final_grade,
      'pendingManualReviews', pending_manual_reviews,
      'isPublished', is_published,
      'gradedAt', graded_at
    ) order by lower(last_name), lower(first_name), attempt_number
  ), '[]'::jsonb)
  into v_result
  from attempt_rows;

  return v_result;
end;
$$;

revoke all on function public.get_exam_overview(uuid) from public;
revoke all on function public.get_exam_question_analytics(uuid) from public;
revoke all on function public.get_exam_student_results(uuid) from public;

grant execute on function public.get_exam_overview(uuid) to authenticated;
grant execute on function public.get_exam_question_analytics(uuid) to authenticated;
grant execute on function public.get_exam_student_results(uuid) to authenticated;
