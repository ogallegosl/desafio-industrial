-- 0016_manual_grading_rubrics.sql
-- Prompt 11: manual grading, reusable rubrics and final-grade recalculation.

create table if not exists public.rubricas (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.preguntas(id) on delete cascade,
  name text not null,
  instructions text,
  is_active boolean not null default true,
  created_by_user_id uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubricas_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.rubrica_criterios (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.rubricas(id) on delete cascade,
  name text not null,
  description text,
  max_points numeric(8,3) not null,
  position integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubrica_criterios_name_not_blank check (btrim(name) <> ''),
  constraint rubrica_criterios_points_positive check (max_points > 0),
  constraint rubrica_criterios_position_positive check (position > 0),
  unique (rubric_id, position)
);

create index if not exists idx_rubricas_question on public.rubricas(question_id);
create index if not exists idx_rubrica_criterios_rubric on public.rubrica_criterios(rubric_id, position);

alter table public.intento_preguntas
  add column if not exists rubric_snapshot jsonb not null default '{}'::jsonb;

alter table public.respuestas
  add column if not exists manual_grading_details jsonb not null default '{}'::jsonb,
  add column if not exists manual_graded_at timestamptz,
  add column if not exists reviewed_by_user_id uuid references public.usuarios(id) on delete set null;

create index if not exists idx_respuestas_manual_queue
  on public.respuestas(review_status, attempt_id)
  where review_status in ('pending'::public.review_status, 'reviewed'::public.review_status);

-- Timestamp support for new rubric tables.
drop trigger if exists trg_rubricas_updated_at on public.rubricas;
create trigger trg_rubricas_updated_at
before update on public.rubricas
for each row execute function public.set_updated_at();

drop trigger if exists trg_rubrica_criterios_updated_at on public.rubrica_criterios;
create trigger trg_rubrica_criterios_updated_at
before update on public.rubrica_criterios
for each row execute function public.set_updated_at();

-- Question ownership helper used by rubric RLS.
create or replace function private.owns_question(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    where q.id = p_question_id
      and private.owns_course(b.course_id)
  ) or private.is_admin()
$$;

revoke all on function private.owns_question(uuid) from public;
grant execute on function private.owns_question(uuid) to authenticated;

-- Reusable rubric snapshot. It is frozen when an attempt question is inserted.
create or replace function private.build_rubric_snapshot(p_question_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce((
    select jsonb_build_object(
      'rubricId', r.id,
      'name', r.name,
      'instructions', r.instructions,
      'criteria', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'description', c.description,
          'maxPoints', c.max_points,
          'position', c.position
        ) order by c.position, c.id)
        from public.rubrica_criterios c
        where c.rubric_id = r.id
      ), '[]'::jsonb)
    )
    from public.rubricas r
    where r.question_id = p_question_id
      and r.is_active = true
    limit 1
  ), '{}'::jsonb)
$$;

create or replace function private.fill_attempt_rubric_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.question_id is not null and (new.rubric_snapshot is null or new.rubric_snapshot = '{}'::jsonb) then
    new.rubric_snapshot := private.build_rubric_snapshot(new.question_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_attempt_rubric_snapshot on public.intento_preguntas;
create trigger trg_fill_attempt_rubric_snapshot
before insert on public.intento_preguntas
for each row execute function private.fill_attempt_rubric_snapshot();

-- Extend snapshot immutability to the frozen rubric.
create or replace function private.prevent_attempt_question_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.intentos i where i.id = old.attempt_id and i.status <> 'cancelled') then
      raise exception 'Las preguntas congeladas de un intento no pueden eliminarse.';
    end if;
    return old;
  end if;

  if old.question_id is distinct from new.question_id
     or old.display_order is distinct from new.display_order
     or old.question_type is distinct from new.question_type
     or old.prompt_snapshot is distinct from new.prompt_snapshot
     or old.options_snapshot is distinct from new.options_snapshot
     or old.grading_snapshot is distinct from new.grading_snapshot
     or old.rubric_snapshot is distinct from new.rubric_snapshot
     or old.points_snapshot is distinct from new.points_snapshot then
    raise exception 'El snapshot de preguntas del intento es inmutable.';
  end if;
  return new;
end;
$$;

-- Recalculate totals after manual grading. For a reviewed response the manual
-- score becomes the authoritative score for that whole question, avoiding
-- double counting a preliminary automatic score.
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
  v_final numeric;
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
  v_scale := coalesce(nullif(v_attempt.frozen_exam_config->>'gradeScaleMax', '')::numeric, v_config.grade_scale_max);
  v_final := case
    when v_pending = 0 and v_max > 0 then round((v_raw / v_max) * v_scale, 3)
    when v_pending = 0 and v_max = 0 then 0
    else null
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

-- Validate and save one manual review atomically.
create or replace function public.grade_manual_response(
  p_response_id uuid,
  p_manual_score numeric,
  p_teacher_feedback text default null,
  p_rubric_scores jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row record;
  v_item jsonb;
  v_score_sum numeric := 0;
  v_max_sum numeric := 0;
  v_item_score numeric;
  v_item_max numeric;
  v_grade jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select
    r.id as response_id,
    r.attempt_id,
    r.review_status,
    q.id as attempt_question_id,
    q.points_snapshot,
    q.rubric_snapshot,
    i.status as attempt_status,
    i.exam_id,
    i.student_id
  into v_row
  from public.respuestas r
  join public.intento_preguntas q on q.id = r.attempt_question_id
  join public.intentos i on i.id = r.attempt_id
  where r.id = p_response_id
  for update of r;

  if not found then raise exception 'RESPONSE_NOT_FOUND'; end if;
  if not private.owns_attempt(v_row.attempt_id) then raise exception 'FORBIDDEN'; end if;
  if v_row.attempt_status not in ('submitted'::public.attempt_status, 'time_expired'::public.attempt_status) then
    raise exception 'ATTEMPT_NOT_CLOSED';
  end if;
  if v_row.review_status not in ('pending'::public.review_status, 'reviewed'::public.review_status) then
    raise exception 'MANUAL_REVIEW_NOT_REQUIRED';
  end if;
  if p_manual_score is null or p_manual_score < 0 or p_manual_score > v_row.points_snapshot then
    raise exception 'MANUAL_SCORE_OUT_OF_RANGE';
  end if;
  if jsonb_typeof(coalesce(p_rubric_scores, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_RUBRIC_SCORES';
  end if;

  if jsonb_array_length(coalesce(p_rubric_scores, '[]'::jsonb)) > 0 then
    for v_item in select value from jsonb_array_elements(p_rubric_scores)
    loop
      v_item_score := nullif(v_item->>'score', '')::numeric;
      v_item_max := nullif(v_item->>'maxPoints', '')::numeric;
      if v_item_score is null or v_item_max is null or v_item_max <= 0 or v_item_score < 0 or v_item_score > v_item_max then
        raise exception 'INVALID_RUBRIC_CRITERION_SCORE';
      end if;
      v_score_sum := v_score_sum + v_item_score;
      v_max_sum := v_max_sum + v_item_max;
    end loop;

    if abs(v_score_sum - p_manual_score) > 0.001 then
      raise exception 'RUBRIC_TOTAL_MISMATCH';
    end if;
    if abs(v_max_sum - v_row.points_snapshot) > 0.001 then
      raise exception 'RUBRIC_MAX_MUST_MATCH_QUESTION_POINTS';
    end if;
  end if;

  update public.respuestas
  set
    manual_score = p_manual_score,
    teacher_feedback = nullif(btrim(coalesce(p_teacher_feedback, '')), ''),
    review_status = 'reviewed'::public.review_status,
    manual_grading_details = jsonb_build_object(
      'rubricScores', coalesce(p_rubric_scores, '[]'::jsonb),
      'questionMaxPoints', v_row.points_snapshot,
      'reviewedBy', auth.uid(),
      'reviewedAt', v_now
    ),
    manual_graded_at = v_now,
    reviewed_by_user_id = auth.uid(),
    updated_at = v_now
  where id = p_response_id;

  v_grade := private.recalculate_attempt_grade(v_row.attempt_id, auth.uid());

  insert into public.logs(actor_user_id, student_id, exam_id, attempt_id, event_type, metadata)
  values (
    auth.uid(), v_row.student_id, v_row.exam_id, v_row.attempt_id,
    'MANUAL_REVIEW_COMPLETED',
    jsonb_build_object(
      'responseId', p_response_id,
      'attemptQuestionId', v_row.attempt_question_id,
      'manualScore', p_manual_score,
      'questionMaxPoints', v_row.points_snapshot,
      'rubricUsed', jsonb_array_length(coalesce(p_rubric_scores, '[]'::jsonb)) > 0
    )
  );

  return jsonb_build_object(
    'responseId', p_response_id,
    'reviewStatus', 'reviewed',
    'manualScore', p_manual_score,
    'grade', v_grade
  );
end;
$$;

-- RLS for rubric templates.
alter table public.rubricas enable row level security;
alter table public.rubrica_criterios enable row level security;

drop policy if exists rubricas_teacher_all on public.rubricas;
create policy rubricas_teacher_all
on public.rubricas for all to authenticated
using (private.owns_question(question_id))
with check (private.owns_question(question_id) and created_by_user_id = auth.uid());

drop policy if exists rubrica_criterios_teacher_all on public.rubrica_criterios;
create policy rubrica_criterios_teacher_all
on public.rubrica_criterios for all to authenticated
using (
  exists (
    select 1 from public.rubricas r
    where r.id = rubric_id and private.owns_question(r.question_id)
  )
)
with check (
  exists (
    select 1 from public.rubricas r
    where r.id = rubric_id and private.owns_question(r.question_id)
  )
);

grant select, insert, update, delete on public.rubricas, public.rubrica_criterios to authenticated;
revoke all on function private.build_rubric_snapshot(uuid) from public;
revoke all on function private.fill_attempt_rubric_snapshot() from public;
revoke all on function private.recalculate_attempt_grade(uuid, uuid) from public;
revoke all on function public.grade_manual_response(uuid, numeric, text, jsonb) from public;
grant execute on function public.grade_manual_response(uuid, numeric, text, jsonb) to authenticated;
