-- 0012_exam_randomization_engine.sql
-- Prompt 07: server-side random selection, frozen attempt snapshots and plan integrity.

alter table public.intento_preguntas
  add column if not exists source_rule_id uuid references public.reglas_seleccion_examen(id) on delete set null,
  add column if not exists selection_source text not null default 'fixed';

do $$ begin
  alter table public.intento_preguntas
    add constraint intento_preguntas_selection_source_valid
    check (selection_source in ('fixed', 'random'));
exception when duplicate_object then null; end $$;

create unique index if not exists intento_preguntas_attempt_question_unique
  on public.intento_preguntas(attempt_id, question_id)
  where question_id is not null;

create index if not exists intento_preguntas_source_rule_idx
  on public.intento_preguntas(source_rule_id);

-- Build the display-only snapshot of a question. Correct answers remain in grading_snapshot.
create or replace function private.question_display_options(p_question_id uuid, p_randomize boolean)
returns jsonb
language sql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
  with ranked as (
    select
      a.id,
      a.option_key,
      a.content,
      row_number() over (
        order by
          case when p_randomize then random() end,
          case when not p_randomize then a.position end,
          a.id
      ) as display_order
    from public.alternativas a
    where a.question_id = p_question_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'key', option_key,
        'content', content,
        'displayOrder', display_order
      ) order by display_order
    ),
    '[]'::jsonb
  )
  from ranked;
$$;

create or replace function private.question_grading_snapshot(p_question_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'answerKey', q.answer_key,
    'numericTolerance', q.numeric_tolerance,
    'gradingConfig', q.grading_config,
    'correctOptionIds', coalesce((
      select jsonb_agg(a.id order by a.position)
      from public.alternativas a
      where a.question_id = q.id and a.is_correct = true
    ), '[]'::jsonb)
  )
  from public.preguntas q
  where q.id = p_question_id;
$$;

create or replace function private.case_display_snapshot(p_question_id uuid, p_randomize_options boolean)
returns jsonb
language sql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'type', c.type,
      'prompt', c.prompt,
      'points', c.points,
      'position', c.case_position,
      'mediaBucket', c.media_bucket,
      'mediaPath', c.media_path,
      'options', private.question_display_options(c.id, p_randomize_options),
      'metadata', c.metadata
    ) order by c.case_position
  ), '[]'::jsonb)
  from public.preguntas c
  where c.parent_question_id = p_question_id;
$$;

create or replace function private.case_grading_snapshot(p_question_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'position', c.case_position,
      'grading', private.question_grading_snapshot(c.id)
    ) order by c.case_position
  ), '[]'::jsonb)
  from public.preguntas c
  where c.parent_question_id = p_question_id;
$$;

-- Generate the attempt exactly once. The attempt row is locked to make double-start idempotent.
create or replace function public.generate_attempt_questions(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_attempt public.intentos%rowtype;
  v_exam public.examenes%rowtype;
  v_cfg public.configuraciones_examen%rowtype;
  v_rule public.reglas_seleccion_examen%rowtype;
  v_row record;
  v_existing integer := 0;
  v_fixed integer := 0;
  v_random integer := 0;
  v_selected integer := 0;
  v_display integer := 0;
  v_candidate_count integer := 0;
  v_total integer := 0;
  v_fingerprint text;
begin
  select * into v_attempt
  from public.intentos
  where id = p_attempt_id
  for update;

  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status not in ('created', 'in_progress') then raise exception 'ATTEMPT_NOT_GENERATABLE'; end if;

  select * into v_exam from public.examenes where id = v_attempt.exam_id;
  select * into v_cfg from public.configuraciones_examen where exam_id = v_attempt.exam_id;
  if not found then raise exception 'EXAM_CONFIGURATION_MISSING'; end if;

  select count(*) into v_existing from public.intento_preguntas where attempt_id = p_attempt_id;
  if v_existing > 0 then
    select encode(extensions.digest(coalesce(string_agg(
      coalesce(question_id::text, 'null') || ':' || display_order::text || ':' || coalesce(options_snapshot::text, '[]'),
      '|' order by display_order
    ), ''), 'sha256'), 'hex')
    into v_fingerprint
    from public.intento_preguntas where attempt_id = p_attempt_id;

    return jsonb_build_object(
      'created', false,
      'questionCount', v_existing,
      'fingerprint', v_fingerprint
    );
  end if;

  create temporary table if not exists pg_temp.prompt07_selected (
    question_id uuid primary key,
    source_rule_id uuid,
    selection_source text not null,
    points_override numeric(8,3),
    base_order bigint
  ) on commit drop;
  truncate pg_temp.prompt07_selected;

  -- Fixed questions are always included.
  insert into pg_temp.prompt07_selected(question_id, source_rule_id, selection_source, points_override, base_order)
  select pe.question_id, null, 'fixed', pe.points_override,
         row_number() over (order by pe.fixed_position nulls last, pe.created_at, pe.id)
  from public.preguntas_examen pe
  join public.preguntas q on q.id = pe.question_id
  join public.bancos_preguntas b on b.id = q.bank_id
  where pe.exam_id = v_attempt.exam_id
    and b.course_id = v_exam.course_id
    and q.parent_question_id is null;

  get diagnostics v_fixed = row_count;

  -- Rules are evaluated in rule_order. Each rule randomly selects from still-unselected candidates.
  for v_rule in
    select * from public.reglas_seleccion_examen
    where exam_id = v_attempt.exam_id
    order by rule_order, id
  loop
    select count(*) into v_candidate_count
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    where b.course_id = v_exam.course_id
      and q.is_active = true
      and q.parent_question_id is null
      and (v_rule.bank_id is null or q.bank_id = v_rule.bank_id)
      and (v_rule.unit is null or q.unit = v_rule.unit)
      and (v_rule.topic is null or q.topic = v_rule.topic)
      and (v_rule.subtopic is null or q.subtopic = v_rule.subtopic)
      and (v_rule.difficulty is null or q.difficulty = v_rule.difficulty)
      and (v_rule.question_type is null or q.type = v_rule.question_type)
      and not exists (select 1 from pg_temp.prompt07_selected s where s.question_id = q.id);

    if v_candidate_count < v_rule.quantity then
      raise exception 'INSUFFICIENT_QUESTIONS_FOR_RULE:%:%:%', v_rule.id, v_rule.quantity, v_candidate_count;
    end if;

    insert into pg_temp.prompt07_selected(question_id, source_rule_id, selection_source, points_override, base_order)
    select q.id, v_rule.id, 'random', v_rule.points_override,
           1000000 + (v_rule.rule_order::bigint * 10000) + row_number() over ()
    from (
      select q.id
      from public.preguntas q
      join public.bancos_preguntas b on b.id = q.bank_id
      where b.course_id = v_exam.course_id
        and q.is_active = true
        and q.parent_question_id is null
        and (v_rule.bank_id is null or q.bank_id = v_rule.bank_id)
        and (v_rule.unit is null or q.unit = v_rule.unit)
        and (v_rule.topic is null or q.topic = v_rule.topic)
        and (v_rule.subtopic is null or q.subtopic = v_rule.subtopic)
        and (v_rule.difficulty is null or q.difficulty = v_rule.difficulty)
        and (v_rule.question_type is null or q.type = v_rule.question_type)
        and not exists (select 1 from pg_temp.prompt07_selected s where s.question_id = q.id)
      order by random()
      limit v_rule.quantity
    ) q;

    get diagnostics v_selected = row_count;
    v_random := v_random + v_selected;
  end loop;

  select count(*) into v_total from pg_temp.prompt07_selected;
  if v_total = 0 then raise exception 'EXAM_HAS_NO_QUESTIONS'; end if;
  if v_total <> v_cfg.target_question_count then
    raise exception 'QUESTION_COUNT_MISMATCH:%:%', v_cfg.target_question_count, v_total;
  end if;

  -- Persist snapshots. When randomize_questions=false, fixed/rule ordering is preserved.
  for v_row in
    select s.*, q.*,
           case when v_cfg.randomize_questions then random() else s.base_order::double precision end as final_order
    from pg_temp.prompt07_selected s
    join public.preguntas q on q.id = s.question_id
    order by final_order, s.base_order, s.question_id
  loop
    v_display := v_display + 1;
    insert into public.intento_preguntas(
      attempt_id,
      question_id,
      source_rule_id,
      selection_source,
      display_order,
      question_type,
      prompt_snapshot,
      media_bucket_snapshot,
      media_path_snapshot,
      points_snapshot,
      options_snapshot,
      grading_snapshot,
      metadata_snapshot
    ) values (
      p_attempt_id,
      v_row.question_id,
      v_row.source_rule_id,
      v_row.selection_source,
      v_display,
      v_row.type,
      v_row.prompt,
      v_row.media_bucket,
      v_row.media_path,
      coalesce(v_row.points_override, v_row.points),
      private.question_display_options(v_row.question_id, v_cfg.randomize_options),
      private.question_grading_snapshot(v_row.question_id)
        || case when v_row.type = 'case_group'::public.question_type
                then jsonb_build_object('caseSubquestions', private.case_grading_snapshot(v_row.question_id))
                else '{}'::jsonb end,
      coalesce(v_row.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'unit', v_row.unit,
          'topic', v_row.topic,
          'subtopic', v_row.subtopic,
          'difficulty', v_row.difficulty,
          'selectionSource', v_row.selection_source,
          'sourceRuleId', v_row.source_rule_id
        )
        || case when v_row.type = 'case_group'::public.question_type
                then jsonb_build_object('caseSubquestions', private.case_display_snapshot(v_row.question_id, v_cfg.randomize_options))
                else '{}'::jsonb end
    );
  end loop;

  select encode(extensions.digest(coalesce(string_agg(
    coalesce(question_id::text, 'null') || ':' || display_order::text || ':' || coalesce(options_snapshot::text, '[]'),
    '|' order by display_order
  ), ''), 'sha256'), 'hex')
  into v_fingerprint
  from public.intento_preguntas where attempt_id = p_attempt_id;

  insert into public.logs(student_id, exam_id, attempt_id, event_type, metadata)
  values (
    v_attempt.student_id,
    v_attempt.exam_id,
    p_attempt_id,
    'ATTEMPT_QUESTIONS_GENERATED',
    jsonb_build_object(
      'questionCount', v_total,
      'fixedCount', v_fixed,
      'randomCount', v_random,
      'randomizeQuestions', v_cfg.randomize_questions,
      'randomizeOptions', v_cfg.randomize_options,
      'fingerprint', v_fingerprint
    )
  );

  return jsonb_build_object(
    'created', true,
    'questionCount', v_total,
    'fixedCount', v_fixed,
    'randomCount', v_random,
    'fingerprint', v_fingerprint
  );
end;
$$;

revoke all on function public.generate_attempt_questions(uuid) from public, anon, authenticated;
grant execute on function public.generate_attempt_questions(uuid) to service_role;

-- Publishing must use an internally coherent plan.
create or replace function public.validate_exam_publishable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cfg public.configuraciones_examen%rowtype;
  v_fixed integer := 0;
  v_random integer := 0;
begin
  if new.status in ('scheduled', 'active') then
    if new.is_deleted then raise exception 'A deleted exam cannot be scheduled or activated'; end if;
    if new.access_code_hash is null or new.access_code_lookup is null then
      raise exception 'Configure an access code before scheduling or activating the exam';
    end if;
    if new.starts_at is null or new.ends_at is null then
      raise exception 'Configure a start and end date before scheduling or activating the exam';
    end if;
    if new.ends_at <= new.starts_at then raise exception 'The exam end date must be later than the start date'; end if;
    if new.ends_at <= now() then raise exception 'The exam end date must be in the future'; end if;

    select * into cfg from public.configuraciones_examen where exam_id = new.id;
    if not found then raise exception 'The exam does not have a configuration'; end if;
    if cfg.duration_minutes <= 0 then raise exception 'The exam duration must be greater than zero'; end if;
    if cfg.target_question_count <= 0 then raise exception 'The target question count must be greater than zero'; end if;

    select count(*) into v_fixed from public.preguntas_examen where exam_id = new.id;
    select coalesce(sum(quantity), 0)::integer into v_random from public.reglas_seleccion_examen where exam_id = new.id;
    if v_fixed + v_random <> cfg.target_question_count then
      raise exception 'The question plan contains % questions but the target is %', v_fixed + v_random, cfg.target_question_count;
    end if;
  end if;
  return new;
end;
$$;

-- Existing generated attempts are immutable even if a bank question is edited later.
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
     or old.points_snapshot is distinct from new.points_snapshot then
    raise exception 'El snapshot de preguntas del intento es inmutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attempt_question_snapshot_immutable on public.intento_preguntas;
create trigger trg_attempt_question_snapshot_immutable
before update or delete on public.intento_preguntas
for each row execute function private.prevent_attempt_question_snapshot_mutation();
