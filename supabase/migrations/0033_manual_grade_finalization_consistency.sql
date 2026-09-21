-- 0033_manual_grade_finalization_consistency.sql
-- Ensures that once all manual responses are reviewed, direct-point exams
-- persist final_grade = sum of earned question points and clear stale pending flags.

create or replace function private.recalculate_attempt_grade(p_attempt_id uuid, p_reviewer uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_attempt public.intentos%rowtype;
  v_config public.configuraciones_examen%rowtype;
  v_auto numeric := 0;
  v_manual numeric := 0;
  v_raw numeric := 0;
  v_max numeric := 0;
  v_pending integer := 0;
  v_scale numeric := 20;
  v_cap numeric := 20;
  v_final numeric;
  v_direct boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_attempt from public.intentos where id = p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  select * into v_config from public.configuraciones_examen where exam_id = v_attempt.exam_id;
  if not found then raise exception 'EXAM_CONFIGURATION_MISSING'; end if;

  select
    coalesce(sum(case when r.review_status = 'reviewed'::public.review_status then 0 else coalesce(r.auto_score, 0) end), 0),
    coalesce(sum(case when r.review_status = 'reviewed'::public.review_status then coalesce(r.manual_score, 0) else 0 end), 0),
    coalesce(sum(case when r.review_status = 'reviewed'::public.review_status then coalesce(r.manual_score, 0) else coalesce(r.auto_score, 0) end), 0),
    coalesce(sum(q.points_snapshot), 0),
    count(*) filter (where r.review_status = 'pending'::public.review_status)
  into v_auto, v_manual, v_raw, v_max, v_pending
  from public.intento_preguntas q
  left join public.respuestas r on r.attempt_question_id = q.id
  where q.attempt_id = p_attempt_id;

  v_raw := least(v_raw, v_max);
  v_scale := coalesce(nullif(v_attempt.frozen_exam_config->>'gradeScaleMax', '')::numeric, v_config.grade_scale_max, 20);
  v_cap := coalesce(
    nullif(v_attempt.frozen_exam_config->>'finalGradeCap', '')::numeric,
    nullif(v_config.settings #>> '{grading,finalGradeCap}', '')::numeric,
    v_scale
  );
  v_cap := greatest(0, least(v_cap, coalesce(v_config.grade_scale_max, v_scale, 20)));
  v_direct := coalesce(v_attempt.frozen_exam_config->>'gradingMode', '') = 'direct_question_points'
    or (v_max > 0 and abs(v_max - v_cap) <= 0.001);

  v_final := case
    when v_pending > 0 then null
    when v_max = 0 then 0
    when v_direct then round(least(greatest(v_raw, 0), v_cap), 3)
    else round(least((v_raw / v_max) * v_scale, v_cap), 3)
  end;

  insert into public.calificaciones(
    attempt_id, auto_score, manual_score, raw_score, max_raw_score,
    final_grade, pending_manual_reviews, graded_by_user_id, graded_at, updated_at
  ) values (
    p_attempt_id, v_auto, v_manual, v_raw, v_max,
    v_final, v_pending, p_reviewer,
    case when v_pending = 0 then v_now else null end, v_now
  )
  on conflict (attempt_id) do update set
    auto_score = excluded.auto_score,
    manual_score = excluded.manual_score,
    raw_score = excluded.raw_score,
    max_raw_score = excluded.max_raw_score,
    final_grade = excluded.final_grade,
    pending_manual_reviews = excluded.pending_manual_reviews,
    graded_by_user_id = coalesce(excluded.graded_by_user_id, calificaciones.graded_by_user_id),
    graded_at = case when excluded.pending_manual_reviews = 0 then v_now else null end,
    updated_at = v_now;

  return jsonb_build_object(
    'attemptId', p_attempt_id,
    'autoScore', v_auto,
    'manualScore', v_manual,
    'rawScore', v_raw,
    'maxRawScore', v_max,
    'pendingManualReviews', v_pending,
    'finalGrade', v_final
  );
end;
$$;

-- Repair direct-point attempts already completed before this consistency fix.
-- Only attempts explicitly frozen in direct_question_points mode are touched.
with direct_completed as (
  select
    c.attempt_id,
    least(
      greatest(coalesce(c.raw_score, 0), 0),
      coalesce(nullif(i.frozen_exam_config->>'finalGradeCap', '')::numeric, c.max_raw_score, 0)
    ) as repaired_final
  from public.calificaciones c
  join public.intentos i on i.id = c.attempt_id
  where coalesce(i.frozen_exam_config->>'gradingMode', '') = 'direct_question_points'
    and c.raw_score is not null
    and c.max_raw_score is not null
    and not exists (
      select 1
      from public.respuestas r
      where r.attempt_id = c.attempt_id
        and r.review_status = 'pending'::public.review_status
    )
)
update public.calificaciones c
set
  pending_manual_reviews = 0,
  final_grade = round(d.repaired_final, 3),
  graded_at = coalesce(c.graded_at, clock_timestamp()),
  updated_at = clock_timestamp()
from direct_completed d
where c.attempt_id = d.attempt_id
  and (
    coalesce(c.pending_manual_reviews, 0) <> 0
    or c.final_grade is distinct from round(d.repaired_final, 3)
  );

revoke all on function private.recalculate_attempt_grade(uuid, uuid) from public, anon, authenticated;

-- Service-role-only refresh used when a student reopens a completed attempt.
-- It makes the corrected PDF read current response state instead of a stale grade snapshot.
create or replace function public.refresh_attempt_grade_for_result(p_attempt_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select private.recalculate_attempt_grade(p_attempt_id, null);
$$;

revoke all on function public.refresh_attempt_grade_for_result(uuid) from public, anon, authenticated;
grant execute on function public.refresh_attempt_grade_for_result(uuid) to service_role;
