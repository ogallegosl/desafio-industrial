-- 0030_teacher_force_close_deadline_fix.sql
-- Hotfix E2E: el cierre docente convierte el momento de cierre
-- en el deadline efectivo antes de abrir la ventana offline de 5 minutos.

create or replace function public.teacher_force_submit_attempt(
  p_attempt_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.intentos%rowtype;
  v_now timestamptz := now();
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  if auth.uid() is null or not private.owns_attempt(p_attempt_id) then
    raise exception 'Attempt not found or not accessible';
  end if;

  select *
  into v_attempt
  from public.intentos
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'Attempt not found';
  end if;

  if v_attempt.status = 'in_progress' then
    update public.intentos
    set status = 'submitted',
        submitted_at = v_now,
        submission_reason = 'TEACHER_FORCED',
        forced_submit_at = v_now,
        forced_submit_by = auth.uid(),
        forced_submit_reason = v_reason,
        deadline_at = least(coalesce(deadline_at, v_now), v_now),
        offline_recovery_until = v_now + interval '5 minutes',
        last_activity_at = v_now,
        last_server_sync_at = v_now,
        updated_at = v_now
    where id = p_attempt_id
    returning * into v_attempt;

  elsif v_attempt.status = 'created' then
    update public.intentos
    set status = 'cancelled',
        submitted_at = v_now,
        submission_reason = 'TEACHER_FORCED_BEFORE_START',
        forced_submit_at = v_now,
        forced_submit_by = auth.uid(),
        forced_submit_reason = v_reason,
        updated_at = v_now
    where id = p_attempt_id
    returning * into v_attempt;
  end if;

  insert into public.logs(
    actor_user_id,
    student_id,
    exam_id,
    attempt_id,
    event_type,
    metadata
  )
  values (
    auth.uid(),
    v_attempt.student_id,
    v_attempt.exam_id,
    v_attempt.id,
    'TEACHER_ATTEMPT_FORCED_CLOSED',
    jsonb_build_object(
      'reason', v_reason,
      'status', v_attempt.status
    )
  );

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', v_attempt.status,
    'submittedAt', v_attempt.submitted_at
  );
end;
$$;


create or replace function public.teacher_force_close_exam(
  p_exam_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_in_progress integer := 0;
  v_prepared integer := 0;
  v_exam public.examenes%rowtype;
begin
  if auth.uid() is null or not private.owns_exam(p_exam_id) then
    raise exception 'Exam not found or not accessible';
  end if;

  select *
  into v_exam
  from public.examenes
  where id = p_exam_id
    and is_deleted = false
  for update;

  if not found then
    raise exception 'Exam not found';
  end if;

  if v_exam.status = 'closed' then
    return jsonb_build_object(
      'examId', p_exam_id,
      'closedAt', v_exam.force_closed_at,
      'submittedAttempts', 0,
      'cancelledPreparedAttempts', 0,
      'alreadyClosed', true
    );
  end if;

  if v_exam.status not in ('scheduled', 'active') then
    raise exception 'Solo un examen programado o activo puede finalizarse desde Monitoreo en vivo.';
  end if;

  update public.examenes
  set status = 'closed',
      accept_new_attempts = false,
      force_closed_at = v_now,
      force_closed_by = auth.uid(),
      control_updated_at = v_now,
      updated_at = v_now
  where id = p_exam_id;

  update public.intentos
  set status = 'submitted',
      submitted_at = v_now,
      submission_reason = 'TEACHER_FORCED',
      forced_submit_at = v_now,
      forced_submit_by = auth.uid(),
      forced_submit_reason = v_reason,
      deadline_at = least(coalesce(deadline_at, v_now), v_now),
      offline_recovery_until = v_now + interval '5 minutes',
      last_activity_at = v_now,
      last_server_sync_at = v_now,
      updated_at = v_now
  where exam_id = p_exam_id
    and status = 'in_progress';

  get diagnostics v_in_progress = row_count;

  update public.intentos
  set status = 'cancelled',
      submitted_at = v_now,
      submission_reason = 'TEACHER_FORCED_BEFORE_START',
      forced_submit_at = v_now,
      forced_submit_by = auth.uid(),
      forced_submit_reason = v_reason,
      updated_at = v_now
  where exam_id = p_exam_id
    and status = 'created';

  get diagnostics v_prepared = row_count;

  insert into public.logs(
    actor_user_id,
    exam_id,
    event_type,
    metadata
  )
  values (
    auth.uid(),
    p_exam_id,
    'TEACHER_EXAM_FORCED_CLOSED',
    jsonb_build_object(
      'reason', v_reason,
      'submittedAttempts', v_in_progress,
      'cancelledPreparedAttempts', v_prepared
    )
  );

  return jsonb_build_object(
    'examId', p_exam_id,
    'closedAt', v_now,
    'submittedAttempts', v_in_progress,
    'cancelledPreparedAttempts', v_prepared,
    'alreadyClosed', false
  );
end;
$$;

revoke all on function public.teacher_force_submit_attempt(uuid, text)
from public, anon;

revoke all on function public.teacher_force_close_exam(uuid, text)
from public, anon;

grant execute on function public.teacher_force_submit_attempt(uuid, text)
to authenticated;

grant execute on function public.teacher_force_close_exam(uuid, text)
to authenticated;