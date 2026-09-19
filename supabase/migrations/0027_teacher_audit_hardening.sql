-- 0027_teacher_audit_hardening.sql
-- Desafío Industrial v1.2.1: exhaustive teacher-panel integrity hardening.
-- Locks published/history-bearing exam plans, protects active random pools,
-- hardens live controls and removes dashboard truncation.

-- ---------------------------------------------------------------------------
-- 1) Exam-plan and structural configuration immutability
-- ---------------------------------------------------------------------------
create or replace function private.guard_exam_plan_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_exam_id uuid := coalesce(new.exam_id, old.exam_id);
  v_status public.exam_status;
  v_has_attempts boolean;
begin
  select e.status,
         exists(select 1 from public.intentos i where i.exam_id = e.id)
    into v_status, v_has_attempts
  from public.examenes e
  where e.id = v_exam_id;

  if not found then
    raise exception 'EXAM_NOT_FOUND';
  end if;

  if v_status <> 'draft'::public.exam_status or v_has_attempts then
    raise exception 'El plan de preguntas solo puede modificarse mientras el examen está en borrador y aún no tiene intentos.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_fixed_exam_plan_mutation on public.preguntas_examen;
create trigger trg_guard_fixed_exam_plan_mutation
before insert or update or delete on public.preguntas_examen
for each row execute function private.guard_exam_plan_mutation();

drop trigger if exists trg_guard_rule_exam_plan_mutation on public.reglas_seleccion_examen;
create trigger trg_guard_rule_exam_plan_mutation
before insert or update or delete on public.reglas_seleccion_examen
for each row execute function private.guard_exam_plan_mutation();

create or replace function private.guard_exam_config_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_status public.exam_status;
  v_has_attempts boolean;
  v_structural_changed boolean;
begin
  select e.status,
         exists(select 1 from public.intentos i where i.exam_id = e.id)
    into v_status, v_has_attempts
  from public.examenes e
  where e.id = old.exam_id;

  if not found then return new; end if;

  v_structural_changed :=
       new.duration_minutes is distinct from old.duration_minutes
    or new.max_attempts is distinct from old.max_attempts
    or new.target_question_count is distinct from old.target_question_count
    or new.randomize_questions is distinct from old.randomize_questions
    or new.randomize_options is distinct from old.randomize_options
    or new.navigation is distinct from old.navigation
    or new.allow_backtrack is distinct from old.allow_backtrack
    or new.auto_submit_on_timeout is distinct from old.auto_submit_on_timeout
    or new.require_student_code is distinct from old.require_student_code
    or new.require_first_name is distinct from old.require_first_name
    or new.require_last_name is distinct from old.require_last_name
    or new.require_email is distinct from old.require_email
    or new.require_section is distinct from old.require_section
    or new.restrict_to_enrolled_students is distinct from old.restrict_to_enrolled_students
    or new.grade_scale_max is distinct from old.grade_scale_max
    or new.passing_grade is distinct from old.passing_grade
    or new.settings is distinct from old.settings;

  if v_structural_changed and (v_status <> 'draft'::public.exam_status or v_has_attempts) then
    raise exception 'La configuración estructural queda bloqueada cuando el examen deja de ser borrador o ya tiene intentos. Duplica el examen para crear otra versión.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_exam_config_mutation on public.configuraciones_examen;
create trigger trg_guard_exam_config_mutation
before update on public.configuraciones_examen
for each row execute function private.guard_exam_config_mutation();

-- Prevent lifecycle actions that would strand live students or rewrite the
-- schedule after attempts already exist. Live extensions are explicitly marked
-- by the dedicated RPC below.
create or replace function private.guard_exam_lifecycle_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_has_attempts boolean;
  v_has_open_attempts boolean;
  v_live_extension boolean := coalesce(current_setting('app.teacher_live_extension', true), '') = '1';
begin
  select
    exists(select 1 from public.intentos i where i.exam_id = old.id),
    exists(select 1 from public.intentos i where i.exam_id = old.id and i.status in ('created','in_progress'))
  into v_has_attempts, v_has_open_attempts;

  if new.starts_at is distinct from old.starts_at and v_has_attempts then
    raise exception 'No se puede modificar la hora de inicio después de registrar intentos.';
  end if;

  if new.ends_at is distinct from old.ends_at and v_has_attempts and not v_live_extension then
    raise exception 'Usa Monitoreo en vivo para ampliar el tiempo de un examen que ya tiene intentos.';
  end if;

  if old.status <> 'draft'::public.exam_status
     and new.status = 'draft'::public.exam_status
     and v_has_attempts then
    raise exception 'Un examen con intentos no puede volver a borrador. Duplica el examen si necesitas editar su estructura.';
  end if;

  if new.status = 'archived'::public.exam_status and v_has_open_attempts then
    raise exception 'Hay estudiantes con intentos abiertos. Finalízalos desde Monitoreo en vivo antes de archivar.';
  end if;

  if new.is_deleted = true and v_has_attempts then
    raise exception 'No se puede eliminar un examen que ya tiene intentos registrados. Archívalo para conservar resultados, evidencias y trazabilidad.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_exam_lifecycle_mutation on public.examenes;
create trigger trg_guard_exam_lifecycle_mutation
before update of starts_at, ends_at, status, is_deleted on public.examenes
for each row execute function private.guard_exam_lifecycle_mutation();

-- ---------------------------------------------------------------------------
-- 2) Protect the question pool used by published exams
-- ---------------------------------------------------------------------------
create or replace function private.guard_bank_archive_for_published_exams()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.is_archived = true and old.is_archived = false and exists (
    select 1
    from public.examenes e
    where e.course_id = old.course_id
      and e.is_deleted = false
      and e.status in ('scheduled','active')
      and (
        exists (
          select 1
          from public.preguntas_examen pe
          join public.preguntas q on q.id = pe.question_id
          where pe.exam_id = e.id and q.bank_id = old.id
        )
        or exists (
          select 1
          from public.reglas_seleccion_examen r
          where r.exam_id = e.id and (r.bank_id = old.id or r.bank_id is null)
        )
      )
  ) then
    raise exception 'Este banco contiene preguntas fijas o candidatas de un examen programado o activo. Devuelve el examen a borrador antes de archivarlo.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_bank_archive_for_published_exams on public.bancos_preguntas;
create trigger trg_guard_bank_archive_for_published_exams
before update of is_archived on public.bancos_preguntas
for each row execute function private.guard_bank_archive_for_published_exams();

-- Resolve whether a question state (or its case-group parent) belongs to a
-- published plan. This freezes both fixed questions and the candidate pool of
-- random rules so students cannot receive different content after publication.
create or replace function private.question_state_in_published_plan(
  p_question_id uuid,
  p_bank_id uuid,
  p_unit text,
  p_topic text,
  p_subtopic text,
  p_difficulty public.question_difficulty,
  p_type public.question_type,
  p_parent_question_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid := p_question_id;
  v_bank_id uuid := p_bank_id;
  v_unit text := p_unit;
  v_topic text := p_topic;
  v_subtopic text := p_subtopic;
  v_difficulty public.question_difficulty := p_difficulty;
  v_type public.question_type := p_type;
  v_course_id uuid;
begin
  if p_parent_question_id is not null then
    select q.id, q.bank_id, q.unit, q.topic, q.subtopic, q.difficulty, q.type
      into v_id, v_bank_id, v_unit, v_topic, v_subtopic, v_difficulty, v_type
    from public.preguntas q
    where q.id = p_parent_question_id;
    if not found then return false; end if;
  end if;

  select b.course_id into v_course_id
  from public.bancos_preguntas b
  where b.id = v_bank_id and b.is_archived = false;
  if not found then return false; end if;

  return exists (
    select 1
    from public.examenes e
    where e.course_id = v_course_id
      and e.is_deleted = false
      and e.status in ('scheduled','active')
      and (
        exists (
          select 1 from public.preguntas_examen pe
          where pe.exam_id = e.id and pe.question_id = v_id
        )
        or exists (
          select 1
          from public.reglas_seleccion_examen r
          where r.exam_id = e.id
            and (r.bank_id is null or r.bank_id = v_bank_id)
            and (r.unit is null or r.unit = v_unit)
            and (r.topic is null or r.topic = v_topic)
            and (r.subtopic is null or r.subtopic = v_subtopic)
            and (r.difficulty is null or r.difficulty = v_difficulty)
            and (r.question_type is null or r.question_type = v_type)
        )
      )
  );
end;
$$;

create or replace function private.guard_published_question_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_old_locked boolean := false;
  v_new_locked boolean := false;
begin
  if tg_op <> 'INSERT' then
    v_old_locked := private.question_state_in_published_plan(
      old.id, old.bank_id, old.unit, old.topic, old.subtopic, old.difficulty, old.type, old.parent_question_id
    );
  end if;
  if tg_op <> 'DELETE' then
    v_new_locked := private.question_state_in_published_plan(
      new.id, new.bank_id, new.unit, new.topic, new.subtopic, new.difficulty, new.type, new.parent_question_id
    );
  end if;

  if tg_op = 'INSERT' and v_new_locked then
    raise exception 'No se pueden agregar preguntas al conjunto candidato de un examen programado o activo. Devuelve el examen a borrador.';
  elsif tg_op = 'DELETE' and v_old_locked then
    raise exception 'No se puede eliminar una pregunta usada por un examen programado o activo. Devuelve el examen a borrador.';
  elsif tg_op = 'UPDATE' and (v_old_locked or v_new_locked) and (
       new.bank_id is distinct from old.bank_id
    or new.type is distinct from old.type
    or new.prompt is distinct from old.prompt
    or new.unit is distinct from old.unit
    or new.topic is distinct from old.topic
    or new.subtopic is distinct from old.subtopic
    or new.difficulty is distinct from old.difficulty
    or new.points is distinct from old.points
    or new.answer_key is distinct from old.answer_key
    or new.numeric_tolerance is distinct from old.numeric_tolerance
    or new.explanation is distinct from old.explanation
    or new.grading_config is distinct from old.grading_config
    or new.metadata is distinct from old.metadata
    or new.media_bucket is distinct from old.media_bucket
    or new.media_path is distinct from old.media_path
    or new.is_active is distinct from old.is_active
    or new.archived_at is distinct from old.archived_at
    or new.parent_question_id is distinct from old.parent_question_id
    or new.case_position is distinct from old.case_position
  ) then
    raise exception 'Esta pregunta forma parte de un examen programado o activo y su contenido está congelado. Devuelve el examen a borrador o duplica el examen.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_published_question_content on public.preguntas;
create trigger trg_guard_published_question_content
before insert or update or delete on public.preguntas
for each row execute function private.guard_published_question_content();

create or replace function private.guard_published_option_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_question_id uuid := coalesce(new.question_id, old.question_id);
  v_q public.preguntas%rowtype;
begin
  select * into v_q from public.preguntas where id = v_question_id;
  if found and private.question_state_in_published_plan(
    v_q.id, v_q.bank_id, v_q.unit, v_q.topic, v_q.subtopic, v_q.difficulty, v_q.type, v_q.parent_question_id
  ) then
    raise exception 'Las alternativas de una pregunta publicada están congeladas. Devuelve el examen a borrador antes de modificarlas.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_published_option_content on public.alternativas;
create trigger trg_guard_published_option_content
before insert or update or delete on public.alternativas
for each row execute function private.guard_published_option_content();

create or replace function private.guard_question_archive_for_published_exams()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.is_active = false and old.is_active = true and private.question_state_in_published_plan(
    old.id, old.bank_id, old.unit, old.topic, old.subtopic, old.difficulty, old.type, old.parent_question_id
  ) then
    raise exception 'Esta pregunta participa en un examen programado o activo. Devuelve el examen a borrador antes de archivarla.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_question_archive_for_published_exams on public.preguntas;
create trigger trg_guard_question_archive_for_published_exams
before update of is_active on public.preguntas
for each row execute function private.guard_question_archive_for_published_exams();

-- ---------------------------------------------------------------------------
-- 3) Revalidate publishability using only active/non-archived material and a
-- conservative overlap check so random rules cannot fail after publication.
-- ---------------------------------------------------------------------------
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
  v_rule public.reglas_seleccion_examen%rowtype;
  v_candidate_count integer;
  v_prior_overlap_quantity integer;
begin
  if new.status in ('scheduled', 'active') then
    if new.is_deleted then raise exception 'No se puede publicar un examen eliminado.'; end if;
    if new.access_code_hash is null or new.access_code_lookup is null then
      raise exception 'Configura un código de acceso antes de programar o activar el examen.';
    end if;
    if new.starts_at is null or new.ends_at is null then
      raise exception 'Configura fecha y hora de inicio y cierre antes de programar o activar.';
    end if;
    if new.ends_at <= new.starts_at then raise exception 'El cierre debe ser posterior al inicio.'; end if;
    if new.ends_at <= now() then raise exception 'La fecha de cierre debe estar en el futuro.'; end if;

    select * into cfg from public.configuraciones_examen where exam_id = new.id;
    if not found then raise exception 'El examen no tiene configuración.'; end if;
    if cfg.duration_minutes <= 0 then raise exception 'La duración debe ser mayor que cero.'; end if;
    if cfg.target_question_count <= 0 then raise exception 'La cantidad objetivo debe ser mayor que cero.'; end if;

    select count(*)::integer into v_fixed
    from public.preguntas_examen pe
    join public.preguntas q on q.id = pe.question_id
    join public.bancos_preguntas b on b.id = q.bank_id
    where pe.exam_id = new.id
      and q.is_active = true
      and q.parent_question_id is null
      and b.is_archived = false
      and b.course_id = new.course_id;

    if v_fixed <> (select count(*) from public.preguntas_examen where exam_id = new.id) then
      raise exception 'El plan contiene preguntas fijas archivadas, inactivas o pertenecientes a un banco archivado.';
    end if;

    select coalesce(sum(quantity), 0)::integer into v_random
    from public.reglas_seleccion_examen where exam_id = new.id;

    if v_fixed + v_random <> cfg.target_question_count then
      raise exception 'El plan contiene % preguntas pero el objetivo es %.', v_fixed + v_random, cfg.target_question_count;
    end if;

    for v_rule in
      select * from public.reglas_seleccion_examen
      where exam_id = new.id
      order by rule_order, id
    loop
      if v_rule.bank_id is not null and exists (
        select 1 from public.bancos_preguntas b where b.id = v_rule.bank_id and b.is_archived = true
      ) then
        raise exception 'Una regla aleatoria usa un banco archivado.';
      end if;

      select count(*)::integer into v_candidate_count
      from public.preguntas q
      join public.bancos_preguntas b on b.id = q.bank_id
      where b.course_id = new.course_id
        and b.is_archived = false
        and q.is_active = true
        and q.parent_question_id is null
        and (v_rule.bank_id is null or q.bank_id = v_rule.bank_id)
        and (v_rule.unit is null or q.unit = v_rule.unit)
        and (v_rule.topic is null or q.topic = v_rule.topic)
        and (v_rule.subtopic is null or q.subtopic = v_rule.subtopic)
        and (v_rule.difficulty is null or q.difficulty = v_rule.difficulty)
        and (v_rule.question_type is null or q.type = v_rule.question_type)
        and not exists (select 1 from public.preguntas_examen pe where pe.exam_id = new.id and pe.question_id = q.id);

      -- Worst-case subtraction of quantities from previous overlapping rules.
      -- This is intentionally conservative: it may ask the teacher for a larger
      -- pool, but it prevents a valid publication from failing randomly later.
      select coalesce(sum(prev.quantity), 0)::integer into v_prior_overlap_quantity
      from public.reglas_seleccion_examen prev
      where prev.exam_id = new.id
        and (prev.rule_order < v_rule.rule_order or (prev.rule_order = v_rule.rule_order and prev.id < v_rule.id))
        and (prev.bank_id is null or v_rule.bank_id is null or prev.bank_id = v_rule.bank_id)
        and (prev.unit is null or v_rule.unit is null or prev.unit = v_rule.unit)
        and (prev.topic is null or v_rule.topic is null or prev.topic = v_rule.topic)
        and (prev.subtopic is null or v_rule.subtopic is null or prev.subtopic = v_rule.subtopic)
        and (prev.difficulty is null or v_rule.difficulty is null or prev.difficulty = v_rule.difficulty)
        and (prev.question_type is null or v_rule.question_type is null or prev.question_type = v_rule.question_type);

      if v_candidate_count - v_prior_overlap_quantity < v_rule.quantity then
        raise exception 'La regla % requiere % preguntas, pero el banco no garantiza suficientes preguntas únicas después de las reglas anteriores (disponibles seguras: %).',
          coalesce(v_rule.metadata->>'label', v_rule.id::text), v_rule.quantity, greatest(0, v_candidate_count - v_prior_overlap_quantity);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Harden live controls and allow schedule extension only through the RPC.
-- ---------------------------------------------------------------------------
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

  select * into v_row from public.examenes where id = p_exam_id and is_deleted = false for update;
  if not found then raise exception 'Exam not found'; end if;
  if v_row.status not in ('scheduled','active') then
    raise exception 'El control de ingresos solo está disponible para exámenes programados o activos.';
  end if;

  update public.examenes
  set accept_new_attempts = coalesce(p_accept, false), control_updated_at = now(), updated_at = now()
  where id = p_exam_id returning * into v_row;

  insert into public.logs(actor_user_id, exam_id, event_type, metadata)
  values (auth.uid(), p_exam_id,
    case when v_row.accept_new_attempts then 'TEACHER_ADMISSIONS_OPENED' else 'TEACHER_ADMISSIONS_CLOSED' end,
    jsonb_build_object('acceptNewAttempts', v_row.accept_new_attempts));

  return jsonb_build_object('examId', v_row.id, 'acceptNewAttempts', v_row.accept_new_attempts, 'updatedAt', v_row.control_updated_at);
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
  v_exam public.examenes%rowtype;
begin
  if auth.uid() is null or not private.owns_exam(p_exam_id) then
    raise exception 'Exam not found or not accessible';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception 'Extension must be between 1 and 120 minutes';
  end if;

  select * into v_exam from public.examenes where id = p_exam_id and is_deleted = false for update;
  if not found then raise exception 'Exam not found'; end if;
  if v_exam.status not in ('scheduled','active') then
    raise exception 'Solo se puede ampliar tiempo en un examen programado o activo.';
  end if;

  perform set_config('app.teacher_live_extension', '1', true);
  update public.examenes
  set ends_at = case when ends_at is null then null else ends_at + make_interval(mins => p_minutes) end,
      control_updated_at = now(), updated_at = now()
  where id = p_exam_id;
  perform set_config('app.teacher_live_extension', '0', true);

  update public.intentos
  set deadline_at = deadline_at + make_interval(mins => p_minutes),
      offline_recovery_until = coalesce(offline_recovery_until, deadline_at + interval '5 minutes') + make_interval(mins => p_minutes),
      extra_time_seconds = extra_time_seconds + p_minutes * 60,
      updated_at = now()
  where exam_id = p_exam_id and status = 'in_progress' and deadline_at is not null;
  get diagnostics v_count = row_count;

  update public.student_attempt_sessions sas
  set expires_at = greatest(sas.expires_at, i.deadline_at + interval '2 hours'), last_seen_at = now()
  from public.intentos i
  where sas.attempt_id = i.id and i.exam_id = p_exam_id and i.status = 'in_progress';

  insert into public.logs(actor_user_id, exam_id, event_type, metadata)
  values (auth.uid(), p_exam_id, 'TEACHER_EXAM_TIME_EXTENDED', jsonb_build_object('minutes', p_minutes, 'affectedAttempts', v_count));

  return jsonb_build_object('examId', p_exam_id, 'minutes', p_minutes, 'affectedAttempts', v_count);
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
  v_exam public.examenes%rowtype;
begin
  if auth.uid() is null or not private.owns_exam(p_exam_id) then
    raise exception 'Exam not found or not accessible';
  end if;

  select * into v_exam from public.examenes where id = p_exam_id and is_deleted = false for update;
  if not found then raise exception 'Exam not found'; end if;
  if v_exam.status = 'closed' then
    return jsonb_build_object('examId', p_exam_id, 'closedAt', v_exam.force_closed_at, 'submittedAttempts', 0, 'cancelledPreparedAttempts', 0, 'alreadyClosed', true);
  end if;
  if v_exam.status not in ('scheduled','active') then
    raise exception 'Solo un examen programado o activo puede finalizarse desde Monitoreo en vivo.';
  end if;

  update public.examenes
  set status = 'closed', accept_new_attempts = false, force_closed_at = v_now,
      force_closed_by = auth.uid(), control_updated_at = v_now, updated_at = v_now
  where id = p_exam_id;

  update public.intentos
  set status = 'submitted', submitted_at = v_now, submission_reason = 'TEACHER_FORCED',
      forced_submit_at = v_now, forced_submit_by = auth.uid(), forced_submit_reason = v_reason,
      offline_recovery_until = v_now + interval '5 minutes', last_activity_at = v_now,
      last_server_sync_at = v_now, updated_at = v_now
  where exam_id = p_exam_id and status = 'in_progress';
  get diagnostics v_in_progress = row_count;

  update public.intentos
  set status = 'cancelled', submitted_at = v_now, submission_reason = 'TEACHER_FORCED_BEFORE_START',
      forced_submit_at = v_now, forced_submit_by = auth.uid(), forced_submit_reason = v_reason, updated_at = v_now
  where exam_id = p_exam_id and status = 'created';
  get diagnostics v_prepared = row_count;

  insert into public.logs(actor_user_id, exam_id, event_type, metadata)
  values (auth.uid(), p_exam_id, 'TEACHER_EXAM_FORCED_CLOSED',
    jsonb_build_object('reason', v_reason, 'submittedAttempts', v_in_progress, 'cancelledPreparedAttempts', v_prepared));

  return jsonb_build_object('examId', p_exam_id, 'closedAt', v_now, 'submittedAttempts', v_in_progress, 'cancelledPreparedAttempts', v_prepared, 'alreadyClosed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Server-side teacher dashboard aggregation (removes the former 1000-row cap)
-- ---------------------------------------------------------------------------
create or replace function public.get_teacher_dashboard()
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_active integer;
  v_upcoming integer;
  v_participants integer;
  v_pending integer;
  v_recent jsonb;
begin
  if auth.uid() is null or private.current_app_role() not in ('teacher','admin') then
    raise exception 'Authentication required';
  end if;

  select count(*)::integer into v_active
  from public.examenes e where e.is_deleted = false and e.status = 'active';

  select count(*)::integer into v_upcoming
  from public.examenes e
  where e.is_deleted = false and e.status in ('scheduled','active')
    and e.starts_at >= now() and e.starts_at <= now() + interval '7 days';

  select count(distinct i.student_id)::integer into v_participants
  from public.intentos i;

  select count(*)::integer into v_pending
  from public.respuestas r where r.review_status = 'pending';

  with recent as (
    select e.id, e.title, e.status, e.starts_at, e.updated_at,
           c.id as course_id, c.name as course_name,
           (select count(distinct i.student_id) from public.intentos i where i.exam_id = e.id)::integer as participants
    from public.examenes e
    left join public.cursos c on c.id = e.course_id
    where e.is_deleted = false
    order by e.updated_at desc
    limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'title', title,
    'status', status,
    'starts_at', starts_at,
    'updated_at', updated_at,
    'participants', participants,
    'cursos', case when course_id is null then null else jsonb_build_object('id', course_id, 'name', course_name) end
  ) order by updated_at desc), '[]'::jsonb)
  into v_recent from recent;

  return jsonb_build_object(
    'active', coalesce(v_active, 0),
    'upcoming', coalesce(v_upcoming, 0),
    'participants', coalesce(v_participants, 0),
    'pendingReviews', coalesce(v_pending, 0),
    'recentExams', v_recent
  );
end;
$$;

revoke all on function public.get_teacher_dashboard() from public, anon;
grant execute on function public.get_teacher_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Runtime generator ignores archived banks. Fixed links are protected by the
-- publish validator above, so reaching an archived fixed bank is an integrity error.
-- ---------------------------------------------------------------------------

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
    and b.is_archived = false
    and q.is_active = true
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
      and b.is_archived = false
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
        and b.is_archived = false
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

-- A course with a published exam must stay active until those exams are closed.
create or replace function private.guard_course_archive_with_published_exams()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.is_active = false and old.is_active = true and exists (
    select 1 from public.examenes e
    where e.course_id = old.id and e.is_deleted = false and e.status in ('scheduled','active')
  ) then
    raise exception 'El curso tiene exámenes programados o activos. Ciérralos o archívalos antes de archivar el curso.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_course_archive_with_published_exams on public.cursos;
create trigger trg_guard_course_archive_with_published_exams
before update of is_active on public.cursos
for each row execute function private.guard_course_archive_with_published_exams();

-- ---------------------------------------------------------------------------
-- 7) Transactional question + alternatives write. Storage media remains a
-- separate compensating operation, but question text and options can no longer
-- be left half-updated by a network/database error between requests.
-- ---------------------------------------------------------------------------
create or replace function public.save_question_core(p_question jsonb, p_options jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid := coalesce(nullif(p_question->>'id','')::uuid, gen_random_uuid());
  v_exists boolean;
  v_type public.question_type := (p_question->>'type')::public.question_type;
  v_option jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(coalesce(p_question->>'bank_id','')), '') is null then raise exception 'Bank is required'; end if;
  if nullif(btrim(coalesce(p_question->>'prompt','')), '') is null then raise exception 'Question prompt is required'; end if;

  select exists(select 1 from public.preguntas q where q.id = v_id) into v_exists;

  if v_exists then
    update public.preguntas
    set bank_id = (p_question->>'bank_id')::uuid,
        type = v_type,
        prompt = btrim(p_question->>'prompt'),
        unit = nullif(p_question->>'unit',''),
        topic = nullif(p_question->>'topic',''),
        subtopic = nullif(p_question->>'subtopic',''),
        difficulty = coalesce(nullif(p_question->>'difficulty',''),'intermediate')::public.question_difficulty,
        points = coalesce((p_question->>'points')::numeric, 1),
        answer_key = coalesce(p_question->'answer_key','{}'::jsonb),
        numeric_tolerance = nullif(p_question->>'numeric_tolerance','')::numeric,
        explanation = nullif(p_question->>'explanation',''),
        grading_config = coalesce(p_question->'grading_config','{}'::jsonb),
        metadata = coalesce(p_question->'metadata','{}'::jsonb),
        is_active = coalesce((p_question->>'is_active')::boolean, true),
        archived_at = nullif(p_question->>'archived_at','')::timestamptz,
        created_by_user_id = coalesce(nullif(p_question->>'created_by_user_id','')::uuid, created_by_user_id),
        parent_question_id = nullif(p_question->>'parent_question_id','')::uuid,
        case_position = nullif(p_question->>'case_position','')::integer,
        updated_at = now()
    where id = v_id;
    if not found then raise exception 'Question not accessible'; end if;
  else
    insert into public.preguntas(
      id, bank_id, type, prompt, unit, topic, subtopic, difficulty, points,
      answer_key, numeric_tolerance, explanation, grading_config, metadata,
      is_active, archived_at, created_by_user_id, parent_question_id, case_position
    ) values (
      v_id,
      (p_question->>'bank_id')::uuid,
      v_type,
      btrim(p_question->>'prompt'),
      nullif(p_question->>'unit',''),
      nullif(p_question->>'topic',''),
      nullif(p_question->>'subtopic',''),
      coalesce(nullif(p_question->>'difficulty',''),'intermediate')::public.question_difficulty,
      coalesce((p_question->>'points')::numeric, 1),
      coalesce(p_question->'answer_key','{}'::jsonb),
      nullif(p_question->>'numeric_tolerance','')::numeric,
      nullif(p_question->>'explanation',''),
      coalesce(p_question->'grading_config','{}'::jsonb),
      coalesce(p_question->'metadata','{}'::jsonb),
      coalesce((p_question->>'is_active')::boolean, true),
      nullif(p_question->>'archived_at','')::timestamptz,
      coalesce(nullif(p_question->>'created_by_user_id','')::uuid, auth.uid()),
      nullif(p_question->>'parent_question_id','')::uuid,
      nullif(p_question->>'case_position','')::integer
    );
  end if;

  delete from public.alternativas where question_id = v_id;

  if v_type in ('single_choice','multiple_choice','image_single_choice') then
    if jsonb_typeof(coalesce(p_options,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_options,'[]'::jsonb)) < 2 then
      raise exception 'Alternative questions require at least two options';
    end if;
    for v_option in select value from jsonb_array_elements(p_options)
    loop
      insert into public.alternativas(question_id, option_key, content, is_correct, position, metadata)
      values (
        v_id,
        nullif(v_option->>'option_key',''),
        btrim(coalesce(v_option->>'content','')),
        coalesce((v_option->>'is_correct')::boolean, false),
        coalesce((v_option->>'position')::integer, 0),
        coalesce(v_option->'metadata','{}'::jsonb)
      );
    end loop;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_question_core(jsonb, jsonb) from public, anon;
grant execute on function public.save_question_core(jsonb, jsonb) to authenticated;
