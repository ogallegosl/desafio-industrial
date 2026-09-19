-- 0021_strict_audit_fixes.sql
-- Strict audit corrections after Prompt 15.

-- 1) A university student code is the stable identity when it exists.
-- Normalize existing values first so subsequent exact comparisons are deterministic.
-- Email-only students already receive a deterministic EMAIL-<hash> code.
update public.estudiantes
set student_code = upper(btrim(student_code))
where student_code <> upper(btrim(student_code));

do $$
begin
  if exists (
    select lower(student_code)
    from public.estudiantes
    group by lower(student_code)
    having count(*) > 1
  ) then
    raise exception 'AUDIT_DUPLICATE_STUDENT_CODES: resolve duplicate student_code values before applying migration 0021';
  end if;
end $$;

create unique index if not exists estudiantes_student_code_ci_unique
  on public.estudiantes (lower(student_code));

create or replace function private.normalize_student_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.student_code := upper(btrim(new.student_code));
  return new;
end;
$$;

drop trigger if exists trg_normalize_student_code on public.estudiantes;
create trigger trg_normalize_student_code
before insert or update of student_code on public.estudiantes
for each row execute function private.normalize_student_code();

-- 2) Bound response text at the database layer as a second line of defense.
do $$ begin
  alter table public.respuestas
    add constraint respuestas_answer_text_length
    check (answer_text is null or char_length(answer_text) <= 20000);
exception when duplicate_object then null; end $$;

-- 3) Atomic autosave. The client revision comparison and write happen inside
-- one PostgreSQL statement, so a late/older request cannot overwrite a newer one.
create or replace function public.save_attempt_answer_if_newer(
  p_attempt_question_id uuid,
  p_attempt_id uuid,
  p_answer_text text,
  p_answer_numeric numeric,
  p_selected_option_ids jsonb,
  p_answer_payload jsonb,
  p_is_answered boolean,
  p_answered_at timestamptz,
  p_last_saved_at timestamptz,
  p_client_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.respuestas%rowtype;
begin
  if p_client_revision < 0 then
    raise exception 'INVALID_CLIENT_REVISION';
  end if;

  insert into public.respuestas (
    attempt_question_id,
    attempt_id,
    answer_text,
    answer_numeric,
    selected_option_ids,
    answer_payload,
    is_answered,
    answered_at,
    last_saved_at,
    client_revision
  ) values (
    p_attempt_question_id,
    p_attempt_id,
    p_answer_text,
    p_answer_numeric,
    coalesce(p_selected_option_ids, '[]'::jsonb),
    coalesce(p_answer_payload, '{}'::jsonb),
    p_is_answered,
    p_answered_at,
    p_last_saved_at,
    p_client_revision
  )
  on conflict (attempt_question_id) do update
  set
    attempt_id = excluded.attempt_id,
    answer_text = excluded.answer_text,
    answer_numeric = excluded.answer_numeric,
    selected_option_ids = excluded.selected_option_ids,
    answer_payload = excluded.answer_payload,
    is_answered = excluded.is_answered,
    answered_at = excluded.answered_at,
    last_saved_at = excluded.last_saved_at,
    client_revision = excluded.client_revision,
    updated_at = now()
  where public.respuestas.client_revision < excluded.client_revision
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'applied', true,
      'clientRevision', v_row.client_revision,
      'lastSavedAt', v_row.last_saved_at,
      'isAnswered', v_row.is_answered
    );
  end if;

  select * into v_row
  from public.respuestas
  where attempt_question_id = p_attempt_question_id;

  if not found then
    raise exception 'ANSWER_SAVE_CONFLICT_WITHOUT_ROW';
  end if;

  return jsonb_build_object(
    'applied', false,
    'clientRevision', v_row.client_revision,
    'lastSavedAt', v_row.last_saved_at,
    'isAnswered', v_row.is_answered
  );
end;
$$;

revoke all on function public.save_attempt_answer_if_newer(uuid, uuid, text, numeric, jsonb, jsonb, boolean, timestamptz, timestamptz, bigint)
from public, anon, authenticated;
grant execute on function public.save_attempt_answer_if_newer(uuid, uuid, text, numeric, jsonb, jsonb, boolean, timestamptz, timestamptz, bigint)
to service_role;

-- 4) Case subquestions cannot require independent uploads because evidence is
-- attached to a top-level attempt_question. Prevent an editor/server mismatch.
create or replace function private.validate_question_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_parent public.preguntas%rowtype;
begin
  if new.parent_question_id is null then
    new.case_position := null;
    return new;
  end if;

  if new.parent_question_id = new.id then
    raise exception 'Una pregunta no puede ser su propio caso padre.';
  end if;

  select * into v_parent from public.preguntas where id = new.parent_question_id;
  if not found then raise exception 'El caso padre no existe.'; end if;
  if v_parent.type <> 'case_group'::public.question_type then raise exception 'La pregunta padre debe ser de tipo case_group.'; end if;
  if v_parent.parent_question_id is not null then raise exception 'No se permiten casos anidados.'; end if;
  if v_parent.bank_id <> new.bank_id then raise exception 'El caso y sus subpreguntas deben pertenecer al mismo banco.'; end if;
  if new.type = 'case_group'::public.question_type then raise exception 'Un caso no puede contener otro caso.'; end if;
  if new.type in ('calculation_evidence'::public.question_type, 'attachment'::public.question_type) then
    raise exception 'Las subpreguntas de un caso no pueden requerir carga de archivos; usa una pregunta independiente.';
  end if;
  if new.case_position is null then raise exception 'Las subpreguntas requieren una posición.'; end if;
  return new;
end;
$$;

-- Fail loudly if an older database already contains unsupported nested upload questions.
do $$
begin
  if exists (
    select 1 from public.preguntas
    where parent_question_id is not null
      and type in ('calculation_evidence'::public.question_type, 'attachment'::public.question_type)
  ) then
    raise exception 'AUDIT_UNSUPPORTED_CASE_UPLOAD_CHILDREN: convert nested calculation_evidence/attachment questions to standalone questions before applying migration 0021';
  end if;
end $$;

-- 5) A hard exam deadline must always close the attempt. Earlier UI exposed a
-- toggle that the runtime intentionally ignored, which was misleading.
update public.configuraciones_examen
set auto_submit_on_timeout = true
where auto_submit_on_timeout = false;

do $$ begin
  alter table public.configuraciones_examen
    add constraint config_auto_submit_timeout_required
    check (auto_submit_on_timeout = true);
exception when duplicate_object then null; end $$;
