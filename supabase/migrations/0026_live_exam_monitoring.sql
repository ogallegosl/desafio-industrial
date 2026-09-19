-- 0026_live_exam_monitoring.sql
-- Desafío Industrial v1.2.0: live teacher monitoring and runtime controls.

alter table public.examenes
  add column if not exists accept_new_attempts boolean not null default true,
  add column if not exists force_closed_at timestamptz,
  add column if not exists force_closed_by uuid references public.usuarios(id) on delete set null,
  add column if not exists control_updated_at timestamptz not null default now();

alter table public.intentos
  add column if not exists extra_time_seconds integer not null default 0,
  add column if not exists forced_submit_at timestamptz,
  add column if not exists forced_submit_by uuid references public.usuarios(id) on delete set null,
  add column if not exists forced_submit_reason text;

alter table public.intentos drop constraint if exists intentos_extra_time_nonnegative;
alter table public.intentos
  add constraint intentos_extra_time_nonnegative check (extra_time_seconds >= 0 and extra_time_seconds <= 86400);

create index if not exists idx_intentos_exam_live
  on public.intentos (exam_id, status, last_server_sync_at desc nulls last, last_activity_at desc nulls last);
create index if not exists idx_logs_exam_security_live
  on public.logs (exam_id, attempt_id, event_at desc)
  where event_type like 'SECURITY_%';

create or replace function public.get_exam_live_monitor(p_exam_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_exam public.examenes%rowtype;
  v_duration integer;
  v_target integer;
  v_attempts jsonb;
  v_summary jsonb;
begin
  if auth.uid() is null or not private.owns_exam(p_exam_id) then
    raise exception 'Exam not found or not accessible';
  end if;

  select * into v_exam from public.examenes where id = p_exam_id and is_deleted = false;
  if not found then raise exception 'Exam not found'; end if;

  select duration_minutes, target_question_count
    into v_duration, v_target
  from public.configuraciones_examen
  where exam_id = p_exam_id;

  with attempt_rows as (
    select
      i.id,
      i.student_id,
      i.attempt_number,
      i.status::text as status,
      i.started_at,
      i.deadline_at,
      i.submitted_at,
      i.last_activity_at,
      i.last_server_sync_at,
      i.current_question_order,
      i.max_question_order_reached,
      i.submission_reason,
      i.extra_time_seconds,
      i.forced_submit_at,
      i.forced_submit_reason,
      s.first_name,
      s.last_name,
      coalesce(q.total_questions, 0)::int as total_questions,
      coalesce(a.answered_count, 0)::int as answered_count,
      coalesce(a.answered_orders, '[]'::jsonb) as answered_orders,
      coalesce(sec.security_incidents, 0)::int as security_incidents
    from public.intentos i
    join public.estudiantes s on s.id = i.student_id
    left join lateral (
      select count(*)::int as total_questions
      from public.intento_preguntas ip
      where ip.attempt_id = i.id
    ) q on true
    left join lateral (
      select
        count(*) filter (where r.is_answered)::int as answered_count,
        coalesce(
          jsonb_agg(ip.display_order order by ip.display_order) filter (where r.is_answered),
          '[]'::jsonb
        ) as answered_orders
      from public.respuestas r
      join public.intento_preguntas ip on ip.id = r.attempt_question_id
      where r.attempt_id = i.id
    ) a on true
    left join lateral (
      select count(*)::int as security_incidents
      from public.logs l
      where l.attempt_id = i.id
        and l.event_type like 'SECURITY_%'
        and l.event_type <> 'SECURITY_TAB_RETURNED'
    ) sec on true
    where i.exam_id = p_exam_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'attemptId', id,
      'studentId', student_id,
      'attemptNumber', attempt_number,
      'studentName', btrim(concat_ws(' ', last_name, first_name)),
      'status', status,
      'startedAt', started_at,
      'deadlineAt', deadline_at,
      'submittedAt', submitted_at,
      'lastActivityAt', last_activity_at,
      'lastServerSyncAt', last_server_sync_at,
      'currentOrder', coalesce(current_question_order, 1),
      'maxReachedOrder', coalesce(max_question_order_reached, 1),
      'answeredCount', answered_count,
      'answeredOrders', answered_orders,
      'totalQuestions', total_questions,
      'securityIncidents', security_incidents,
      'extraTimeSeconds', extra_time_seconds,
      'submissionReason', submission_reason,
      'forcedSubmitAt', forced_submit_at,
      'forcedSubmitReason', forced_submit_reason,
      'remainingSeconds', case
        when deadline_at is null then null
        else greatest(0, floor(extract(epoch from (deadline_at - now())))::int)
      end
    )
    order by
      case status when 'in_progress' then 0 when 'created' then 1 when 'submitted' then 2 when 'time_expired' then 3 else 4 end,
      last_name, first_name, attempt_number
  ), '[]'::jsonb)
  into v_attempts
  from attempt_rows;

  with attempts as (
    select * from public.intentos where exam_id = p_exam_id
  )
  select jsonb_build_object(
    'participants', count(distinct student_id),
    'inProgress', count(*) filter (where status = 'in_progress'),
    'prepared', count(*) filter (where status = 'created'),
    'submitted', count(*) filter (where status = 'submitted'),
    'timeExpired', count(*) filter (where status = 'time_expired'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'securityIncidents', coalesce((select count(*) from public.logs l where l.exam_id = p_exam_id and l.event_type like 'SECURITY_%' and l.event_type <> 'SECURITY_TAB_RETURNED'), 0)
  ) into v_summary
  from attempts;

  return jsonb_build_object(
    'serverNow', now(),
    'exam', jsonb_build_object(
      'id', v_exam.id,
      'title', v_exam.title,
      'status', v_exam.status,
      'startsAt', v_exam.starts_at,
      'endsAt', v_exam.ends_at,
      'acceptNewAttempts', v_exam.accept_new_attempts,
      'forceClosedAt', v_exam.force_closed_at,
      'durationMinutes', v_duration,
      'targetQuestionCount', v_target
    ),
    'summary', v_summary,
    'attempts', v_attempts
  );
end;
$$;

create or replace function public.set_exam_accept_new_attempts(p_exam_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_row public.examenes%rowtype;
begin
  if auth.uid() is null or not private.owns_exam(p_exam_id) then
    raise exception 'Exam not found or not accessible';
  end if;

  update public.examenes
  set accept_new_attempts = coalesce(p_accept, false),
      control_updated_at = now(),
      updated_at = now()
  where id = p_exam_id and is_deleted = false
  returning * into v_row;

  if not found then raise exception 'Exam not found'; end if;

  insert into public.logs(actor_user_id, exam_id, event_type, metadata)
  values (auth.uid(), p_exam_id,
    case when v_row.accept_new_attempts then 'TEACHER_ADMISSIONS_OPENED' else 'TEACHER_ADMISSIONS_CLOSED' end,
    jsonb_build_object('acceptNewAttempts', v_row.accept_new_attempts));

  return jsonb_build_object('examId', v_row.id, 'acceptNewAttempts', v_row.accept_new_attempts, 'updatedAt', v_row.control_updated_at);
end;
$$;

create or replace function public.teacher_extend_attempt_time(p_attempt_id uuid, p_minutes integer)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.intentos%rowtype;
  v_new_deadline timestamptz;
begin
  if auth.uid() is null or not private.owns_attempt(p_attempt_id) then
    raise exception 'Attempt not found or not accessible';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception 'Extension must be between 1 and 120 minutes';
  end if;

  update public.intentos
  set deadline_at = deadline_at + make_interval(mins => p_minutes),
      offline_recovery_until = coalesce(offline_recovery_until, deadline_at + interval '5 minutes') + make_interval(mins => p_minutes),
      extra_time_seconds = extra_time_seconds + p_minutes * 60,
      updated_at = now()
  where id = p_attempt_id and status = 'in_progress' and deadline_at is not null
  returning * into v_attempt;

  if not found then raise exception 'Attempt is not in progress'; end if;
  v_new_deadline := v_attempt.deadline_at;

  update public.student_attempt_sessions
  set expires_at = greatest(expires_at, v_new_deadline + interval '2 hours'),
      last_seen_at = now()
  where attempt_id = p_attempt_id;

  insert into public.logs(actor_user_id, student_id, exam_id, attempt_id, event_type, metadata)
  values (auth.uid(), v_attempt.student_id, v_attempt.exam_id, v_attempt.id, 'TEACHER_TIME_EXTENDED',
    jsonb_build_object('minutes', p_minutes, 'deadlineAt', v_new_deadline));

  return jsonb_build_object('attemptId', v_attempt.id, 'deadlineAt', v_new_deadline, 'extraTimeSeconds', v_attempt.extra_time_seconds);
end;
$$;

create or replace function public.teacher_extend_exam_time(p_exam_id uuid, p_minutes integer)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not private.owns_exam(p_exam_id) then
    raise exception 'Exam not found or not accessible';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception 'Extension must be between 1 and 120 minutes';
  end if;

  update public.examenes
  set ends_at = case when ends_at is null then null else ends_at + make_interval(mins => p_minutes) end,
      control_updated_at = now(),
      updated_at = now()
  where id = p_exam_id and is_deleted = false;

  update public.intentos
  set deadline_at = deadline_at + make_interval(mins => p_minutes),
      offline_recovery_until = coalesce(offline_recovery_until, deadline_at + interval '5 minutes') + make_interval(mins => p_minutes),
      extra_time_seconds = extra_time_seconds + p_minutes * 60,
      updated_at = now()
  where exam_id = p_exam_id and status = 'in_progress' and deadline_at is not null;
  get diagnostics v_count = row_count;

  update public.student_attempt_sessions sas
  set expires_at = greatest(sas.expires_at, i.deadline_at + interval '2 hours'),
      last_seen_at = now()
  from public.intentos i
  where sas.attempt_id = i.id and i.exam_id = p_exam_id and i.status = 'in_progress';

  insert into public.logs(actor_user_id, exam_id, event_type, metadata)
  values (auth.uid(), p_exam_id, 'TEACHER_EXAM_TIME_EXTENDED', jsonb_build_object('minutes', p_minutes, 'affectedAttempts', v_count));

  return jsonb_build_object('examId', p_exam_id, 'minutes', p_minutes, 'affectedAttempts', v_count);
end;
$$;

create or replace function public.teacher_force_submit_attempt(p_attempt_id uuid, p_reason text default null)
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

  select * into v_attempt from public.intentos where id = p_attempt_id for update;
  if not found then raise exception 'Attempt not found'; end if;

  if v_attempt.status = 'in_progress' then
    update public.intentos
    set status = 'submitted',
        submitted_at = v_now,
        submission_reason = 'TEACHER_FORCED',
        forced_submit_at = v_now,
        forced_submit_by = auth.uid(),
        forced_submit_reason = v_reason,
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

  insert into public.logs(actor_user_id, student_id, exam_id, attempt_id, event_type, metadata)
  values (auth.uid(), v_attempt.student_id, v_attempt.exam_id, v_attempt.id, 'TEACHER_ATTEMPT_FORCED_CLOSED',
    jsonb_build_object('reason', v_reason, 'status', v_attempt.status));

  return jsonb_build_object('attemptId', v_attempt.id, 'status', v_attempt.status, 'submittedAt', v_attempt.submitted_at);
end;
$$;

create or replace function public.teacher_force_close_exam(p_exam_id uuid, p_reason text default null)
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
begin
  if auth.uid() is null or not private.owns_exam(p_exam_id) then
    raise exception 'Exam not found or not accessible';
  end if;

  update public.examenes
  set status = 'closed',
      accept_new_attempts = false,
      force_closed_at = v_now,
      force_closed_by = auth.uid(),
      control_updated_at = v_now,
      updated_at = v_now
  where id = p_exam_id and is_deleted = false;
  if not found then raise exception 'Exam not found'; end if;

  update public.intentos
  set status = 'submitted',
      submitted_at = v_now,
      submission_reason = 'TEACHER_FORCED',
      forced_submit_at = v_now,
      forced_submit_by = auth.uid(),
      forced_submit_reason = v_reason,
      offline_recovery_until = v_now + interval '5 minutes',
      last_activity_at = v_now,
      last_server_sync_at = v_now,
      updated_at = v_now
  where exam_id = p_exam_id and status = 'in_progress';
  get diagnostics v_in_progress = row_count;

  update public.intentos
  set status = 'cancelled',
      submitted_at = v_now,
      submission_reason = 'TEACHER_FORCED_BEFORE_START',
      forced_submit_at = v_now,
      forced_submit_by = auth.uid(),
      forced_submit_reason = v_reason,
      updated_at = v_now
  where exam_id = p_exam_id and status = 'created';
  get diagnostics v_prepared = row_count;

  insert into public.logs(actor_user_id, exam_id, event_type, metadata)
  values (auth.uid(), p_exam_id, 'TEACHER_EXAM_FORCED_CLOSED',
    jsonb_build_object('reason', v_reason, 'submittedAttempts', v_in_progress, 'cancelledPreparedAttempts', v_prepared));

  return jsonb_build_object('examId', p_exam_id, 'closedAt', v_now, 'submittedAttempts', v_in_progress, 'cancelledPreparedAttempts', v_prepared);
end;
$$;

revoke all on function public.get_exam_live_monitor(uuid) from public, anon;
revoke all on function public.set_exam_accept_new_attempts(uuid, boolean) from public, anon;
revoke all on function public.teacher_extend_attempt_time(uuid, integer) from public, anon;
revoke all on function public.teacher_extend_exam_time(uuid, integer) from public, anon;
revoke all on function public.teacher_force_submit_attempt(uuid, text) from public, anon;
revoke all on function public.teacher_force_close_exam(uuid, text) from public, anon;

grant execute on function public.get_exam_live_monitor(uuid) to authenticated;
grant execute on function public.set_exam_accept_new_attempts(uuid, boolean) to authenticated;
grant execute on function public.teacher_extend_attempt_time(uuid, integer) to authenticated;
grant execute on function public.teacher_extend_exam_time(uuid, integer) to authenticated;
grant execute on function public.teacher_force_submit_attempt(uuid, text) to authenticated;
grant execute on function public.teacher_force_close_exam(uuid, text) to authenticated;

-- Enable Postgres Changes for the teacher monitor when the standard Supabase
-- realtime publication exists. Guards make the migration idempotent.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'intentos') then
      execute 'alter publication supabase_realtime add table public.intentos';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'logs') then
      execute 'alter publication supabase_realtime add table public.logs';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'examenes') then
      execute 'alter publication supabase_realtime add table public.examenes';
    end if;
  end if;
end $$;
