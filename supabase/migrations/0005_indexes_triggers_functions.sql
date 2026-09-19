-- 0005_indexes_triggers_functions.sql
-- Performance, timestamps and secure helper functions.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'usuarios','docentes','estudiantes','cursos','matriculas','bancos_preguntas',
    'preguntas','alternativas','examenes','configuraciones_examen',
    'preguntas_examen','reglas_seleccion_examen','intentos','respuestas',
    'evidencias','calificaciones'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', tbl, tbl);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()',
      tbl, tbl
    );
  end loop;
end $$;

create index if not exists idx_docentes_usuario on public.docentes(usuario_id);
create index if not exists idx_estudiantes_creator on public.estudiantes(created_by_user_id);
create index if not exists idx_estudiantes_code on public.estudiantes(lower(student_code));
create index if not exists idx_cursos_docente on public.cursos(docente_id);
create index if not exists idx_matriculas_course on public.matriculas(course_id);
create index if not exists idx_matriculas_student on public.matriculas(student_id);
create index if not exists idx_bancos_course on public.bancos_preguntas(course_id);
create index if not exists idx_bancos_owner on public.bancos_preguntas(owner_user_id);
create index if not exists idx_preguntas_bank on public.preguntas(bank_id);
create index if not exists idx_preguntas_filters on public.preguntas(bank_id, unit, topic, difficulty, type) where is_active = true;
create index if not exists idx_alternativas_question on public.alternativas(question_id);
create index if not exists idx_examenes_course on public.examenes(course_id);
create index if not exists idx_examenes_owner on public.examenes(owner_user_id);
create index if not exists idx_examenes_schedule on public.examenes(starts_at, ends_at, status) where is_deleted = false;
create index if not exists idx_preguntas_examen_exam on public.preguntas_examen(exam_id);
create index if not exists idx_selection_rules_exam on public.reglas_seleccion_examen(exam_id, rule_order);
create index if not exists idx_intentos_exam_student on public.intentos(exam_id, student_id);
create index if not exists idx_intentos_status on public.intentos(exam_id, status);
create index if not exists idx_intento_preguntas_attempt on public.intento_preguntas(attempt_id, display_order);
create index if not exists idx_respuestas_attempt on public.respuestas(attempt_id);
create index if not exists idx_evidencias_attempt on public.evidencias(attempt_id);
create index if not exists idx_logs_attempt_time on public.logs(attempt_id, event_at desc);
create index if not exists idx_logs_exam_time on public.logs(exam_id, event_at desc);

-- A teacher may edit profile fields but cannot promote themselves or reactivate
-- an account by changing authorization-critical columns.
create or replace function public.protect_usuario_security_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not private.is_admin() then
    raise exception 'Only an administrator can change role or active status';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_usuario_security_fields on public.usuarios;
create trigger trg_protect_usuario_security_fields
before update of role, is_active on public.usuarios
for each row execute function public.protect_usuario_security_fields();

-- Helper functions use SECURITY DEFINER to avoid recursive RLS checks.
create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.usuarios u
  where u.id = auth.uid()
    and u.is_active = true
  limit 1
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'admin', false)
$$;

create or replace function private.current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.docentes d
  join public.usuarios u on u.id = d.usuario_id
  where d.usuario_id = auth.uid()
    and u.is_active = true
  limit 1
$$;

create or replace function private.owns_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cursos c
    join public.docentes d on d.id = c.docente_id
    where c.id = p_course_id
      and d.usuario_id = auth.uid()
  ) or private.is_admin()
$$;

create or replace function private.owns_exam(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.examenes e
    where e.id = p_exam_id
      and (e.owner_user_id = auth.uid() or private.owns_course(e.course_id))
  ) or private.is_admin()
$$;

create or replace function private.owns_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.intentos i
    where i.id = p_attempt_id
      and private.owns_exam(i.exam_id)
  ) or private.is_admin()
$$;

revoke all on function private.current_app_role() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.current_teacher_id() from public;
revoke all on function private.owns_course(uuid) from public;
revoke all on function private.owns_exam(uuid) from public;
revoke all on function private.owns_attempt(uuid) from public;

grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.current_teacher_id() to authenticated;
grant execute on function private.owns_course(uuid) to authenticated;
grant execute on function private.owns_exam(uuid) to authenticated;
grant execute on function private.owns_attempt(uuid) to authenticated;
