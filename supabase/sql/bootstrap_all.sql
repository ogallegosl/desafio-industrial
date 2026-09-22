-- >>> BEGIN MIGRATION: 0001_extensions_enums.sql
-- 0001_extensions_enums.sql
-- Base types for the evaluation platform.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.app_role as enum ('admin', 'teacher');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_type as enum (
    'single_choice',
    'multiple_choice',
    'true_false',
    'short_text',
    'numeric',
    'essay',
    'image_single_choice',
    'image_essay',
    'calculation',
    'calculation_evidence',
    'case_group',
    'attachment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_difficulty as enum ('basic', 'intermediate', 'advanced');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.exam_status as enum ('draft', 'scheduled', 'active', 'closed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attempt_status as enum (
    'created',
    'in_progress',
    'submitted',
    'time_expired',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.navigation_mode as enum ('free', 'sequential');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.result_visibility as enum (
    'confirmation_only',
    'score_only',
    'grade',
    'correct_answers',
    'full_feedback'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.enrollment_status as enum ('active', 'inactive', 'completed', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('not_required', 'pending', 'reviewed');
exception when duplicate_object then null; end $$;
-- <<< END MIGRATION: 0001_extensions_enums.sql

-- >>> BEGIN MIGRATION: 0002_core_tables.sql
-- 0002_core_tables.sql
-- Users, teachers, students, courses, enrollments and question banks.

create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'teacher',
  first_name text,
  last_name text,
  display_name text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.docentes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios(id) on delete cascade,
  employee_code text,
  institution_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.estudiantes (
  id uuid primary key default gen_random_uuid(),
  student_code text not null,
  first_name text not null,
  last_name text not null,
  email text,
  section text,
  created_by_user_id uuid references public.usuarios(id) on delete set null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estudiantes_code_not_blank check (btrim(student_code) <> '')
);

create unique index if not exists estudiantes_code_email_unique
  on public.estudiantes (lower(student_code), lower(coalesce(email, '')));

create table if not exists public.cursos (
  id uuid primary key default gen_random_uuid(),
  docente_id uuid not null references public.docentes(id) on delete restrict,
  code text,
  name text not null,
  description text,
  academic_period text,
  section text,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cursos_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.matriculas (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.cursos(id) on delete cascade,
  student_id uuid not null references public.estudiantes(id) on delete cascade,
  status public.enrollment_status not null default 'active',
  enrolled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, student_id)
);

create table if not exists public.bancos_preguntas (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.cursos(id) on delete cascade,
  owner_user_id uuid not null references public.usuarios(id) on delete restrict,
  name text not null,
  description text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bancos_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.preguntas (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.bancos_preguntas(id) on delete cascade,
  type public.question_type not null,
  prompt text not null,
  unit text,
  topic text,
  subtopic text,
  difficulty public.question_difficulty not null default 'intermediate',
  media_bucket text,
  media_path text,
  points numeric(8,3) not null default 1,
  answer_key jsonb not null default '{}'::jsonb,
  numeric_tolerance numeric(18,6),
  explanation text,
  grading_config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by_user_id uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint preguntas_prompt_not_blank check (btrim(prompt) <> ''),
  constraint preguntas_points_nonnegative check (points >= 0),
  constraint preguntas_tolerance_nonnegative check (numeric_tolerance is null or numeric_tolerance >= 0),
  constraint preguntas_media_pair check (
    (media_bucket is null and media_path is null)
    or
    (media_bucket is not null and media_path is not null)
  )
);

create table if not exists public.alternativas (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.preguntas(id) on delete cascade,
  option_key text,
  content text not null,
  is_correct boolean not null default false,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alternativas_content_not_blank check (btrim(content) <> ''),
  constraint alternativas_position_nonnegative check (position >= 0)
);

create unique index if not exists alternativas_question_position_unique
  on public.alternativas(question_id, position);
-- <<< END MIGRATION: 0002_core_tables.sql

-- >>> BEGIN MIGRATION: 0003_exam_tables.sql
-- 0003_exam_tables.sql
-- Exams, configuration, fixed questions and random-selection rules.

create table if not exists public.examenes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.cursos(id) on delete cascade,
  owner_user_id uuid not null references public.usuarios(id) on delete restrict,
  title text not null,
  description text,
  instructions text,
  access_code_hash text,
  access_code_hint text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.exam_status not null default 'draft',
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint examenes_title_not_blank check (btrim(title) <> ''),
  constraint examenes_time_window_valid check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create table if not exists public.configuraciones_examen (
  exam_id uuid primary key references public.examenes(id) on delete cascade,
  duration_minutes integer not null default 60,
  max_attempts integer not null default 1,
  randomize_questions boolean not null default true,
  randomize_options boolean not null default true,
  navigation public.navigation_mode not null default 'free',
  allow_backtrack boolean not null default true,
  auto_submit_on_timeout boolean not null default true,
  result_visibility public.result_visibility not null default 'confirmation_only',
  show_results_after timestamptz,
  require_student_code boolean not null default true,
  require_first_name boolean not null default true,
  require_last_name boolean not null default true,
  require_email boolean not null default false,
  require_section boolean not null default false,
  grade_scale_max numeric(8,3) not null default 20,
  passing_grade numeric(8,3) not null default 10.5,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint config_duration_positive check (duration_minutes > 0),
  constraint config_attempts_positive check (max_attempts > 0),
  constraint config_grade_scale_positive check (grade_scale_max > 0),
  constraint config_passing_grade_valid check (passing_grade >= 0 and passing_grade <= grade_scale_max)
);

create table if not exists public.preguntas_examen (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.examenes(id) on delete cascade,
  question_id uuid not null references public.preguntas(id) on delete restrict,
  fixed_position integer,
  points_override numeric(8,3),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, question_id),
  constraint preguntas_examen_position_positive check (fixed_position is null or fixed_position > 0),
  constraint preguntas_examen_points_nonnegative check (points_override is null or points_override >= 0)
);

create table if not exists public.reglas_seleccion_examen (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.examenes(id) on delete cascade,
  bank_id uuid references public.bancos_preguntas(id) on delete restrict,
  unit text,
  topic text,
  subtopic text,
  difficulty public.question_difficulty,
  question_type public.question_type,
  quantity integer not null,
  rule_order integer not null default 0,
  points_override numeric(8,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint selection_quantity_positive check (quantity > 0),
  constraint selection_order_nonnegative check (rule_order >= 0),
  constraint selection_points_nonnegative check (points_override is null or points_override >= 0)
);
-- <<< END MIGRATION: 0003_exam_tables.sql

-- >>> BEGIN MIGRATION: 0004_attempt_response_tables.sql
-- 0004_attempt_response_tables.sql
-- Attempts, frozen question snapshots, answers, evidence, grades and logs.

create table if not exists public.intentos (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.examenes(id) on delete restrict,
  student_id uuid not null references public.estudiantes(id) on delete restrict,
  attempt_number integer not null,
  status public.attempt_status not null default 'created',
  started_at timestamptz,
  deadline_at timestamptz,
  submitted_at timestamptz,
  last_activity_at timestamptz,
  client_started_at timestamptz,
  submission_reason text,
  frozen_exam_config jsonb not null default '{}'::jsonb,
  session_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id, attempt_number),
  constraint intentos_attempt_number_positive check (attempt_number > 0),
  constraint intentos_deadline_after_start check (
    started_at is null or deadline_at is null or deadline_at > started_at
  ),
  constraint intentos_submit_after_start check (
    started_at is null or submitted_at is null or submitted_at >= started_at
  )
);

create table if not exists public.intento_preguntas (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.intentos(id) on delete cascade,
  question_id uuid references public.preguntas(id) on delete set null,
  display_order integer not null,
  question_type public.question_type not null,
  prompt_snapshot text not null,
  media_bucket_snapshot text,
  media_path_snapshot text,
  points_snapshot numeric(8,3) not null,
  options_snapshot jsonb not null default '[]'::jsonb,
  grading_snapshot jsonb not null default '{}'::jsonb,
  metadata_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (attempt_id, display_order),
  constraint intento_preguntas_order_positive check (display_order > 0),
  constraint intento_preguntas_points_nonnegative check (points_snapshot >= 0),
  constraint intento_preguntas_media_pair check (
    (media_bucket_snapshot is null and media_path_snapshot is null)
    or
    (media_bucket_snapshot is not null and media_path_snapshot is not null)
  )
);

create table if not exists public.respuestas (
  id uuid primary key default gen_random_uuid(),
  attempt_question_id uuid not null unique references public.intento_preguntas(id) on delete cascade,
  attempt_id uuid not null references public.intentos(id) on delete cascade,
  answer_text text,
  answer_numeric numeric(24,8),
  selected_option_ids jsonb not null default '[]'::jsonb,
  answer_payload jsonb not null default '{}'::jsonb,
  is_answered boolean not null default false,
  is_correct boolean,
  auto_score numeric(8,3),
  manual_score numeric(8,3),
  review_status public.review_status not null default 'not_required',
  teacher_feedback text,
  answered_at timestamptz,
  last_saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint respuestas_auto_score_nonnegative check (auto_score is null or auto_score >= 0),
  constraint respuestas_manual_score_nonnegative check (manual_score is null or manual_score >= 0)
);

create table if not exists public.evidencias (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.respuestas(id) on delete cascade,
  attempt_id uuid not null references public.intentos(id) on delete cascade,
  bucket_name text not null default 'student-evidence',
  object_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_name, object_path),
  constraint evidencias_size_positive check (size_bytes > 0),
  constraint evidencias_path_not_blank check (btrim(object_path) <> ''),
  constraint evidencias_filename_not_blank check (btrim(original_filename) <> '')
);

create table if not exists public.calificaciones (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.intentos(id) on delete cascade,
  auto_score numeric(10,3) not null default 0,
  manual_score numeric(10,3) not null default 0,
  raw_score numeric(10,3) not null default 0,
  max_raw_score numeric(10,3) not null default 0,
  final_grade numeric(10,3),
  is_published boolean not null default false,
  published_at timestamptz,
  general_feedback text,
  graded_by_user_id uuid references public.usuarios(id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calificaciones_scores_nonnegative check (
    auto_score >= 0 and manual_score >= 0 and raw_score >= 0 and max_raw_score >= 0
  )
);

create table if not exists public.logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.usuarios(id) on delete set null,
  student_id uuid references public.estudiantes(id) on delete set null,
  exam_id uuid references public.examenes(id) on delete set null,
  attempt_id uuid references public.intentos(id) on delete set null,
  event_type text not null,
  event_at timestamptz not null default now(),
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  constraint logs_event_type_not_blank check (btrim(event_type) <> '')
);

-- "resultados" is intentionally a view to avoid duplicated grade state.
create or replace view public.resultados
with (security_invoker = true)
as
select
  i.id as attempt_id,
  i.exam_id,
  i.student_id,
  i.attempt_number,
  i.status as attempt_status,
  i.started_at,
  i.submitted_at,
  i.deadline_at,
  c.auto_score,
  c.manual_score,
  c.raw_score,
  c.max_raw_score,
  c.final_grade,
  c.is_published,
  c.published_at,
  c.graded_at
from public.intentos i
left join public.calificaciones c on c.attempt_id = i.id;
-- <<< END MIGRATION: 0004_attempt_response_tables.sql

-- >>> BEGIN MIGRATION: 0005_indexes_triggers_functions.sql
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
-- <<< END MIGRATION: 0005_indexes_triggers_functions.sql

-- >>> BEGIN MIGRATION: 0006_rls_policies.sql
-- 0006_rls_policies.sql
-- RLS defaults to deny. No anonymous/student direct access is granted yet.

alter table public.usuarios enable row level security;
alter table public.docentes enable row level security;
alter table public.estudiantes enable row level security;
alter table public.cursos enable row level security;
alter table public.matriculas enable row level security;
alter table public.bancos_preguntas enable row level security;
alter table public.preguntas enable row level security;
alter table public.alternativas enable row level security;
alter table public.examenes enable row level security;
alter table public.configuraciones_examen enable row level security;
alter table public.preguntas_examen enable row level security;
alter table public.reglas_seleccion_examen enable row level security;
alter table public.intentos enable row level security;
alter table public.intento_preguntas enable row level security;
alter table public.respuestas enable row level security;
alter table public.evidencias enable row level security;
alter table public.calificaciones enable row level security;
alter table public.logs enable row level security;

-- Usuarios
drop policy if exists usuarios_select_self_or_admin on public.usuarios;
create policy usuarios_select_self_or_admin
on public.usuarios for select to authenticated
using (id = auth.uid() or private.is_admin());

drop policy if exists usuarios_update_self_or_admin on public.usuarios;
create policy usuarios_update_self_or_admin
on public.usuarios for update to authenticated
using (id = auth.uid() or private.is_admin())
with check (id = auth.uid() or private.is_admin());

-- Docentes
drop policy if exists docentes_select_self_or_admin on public.docentes;
create policy docentes_select_self_or_admin
on public.docentes for select to authenticated
using (usuario_id = auth.uid() or private.is_admin());

drop policy if exists docentes_admin_all on public.docentes;
create policy docentes_admin_all
on public.docentes for all to authenticated
using (private.is_admin())
with check (private.is_admin());

-- Estudiantes
drop policy if exists estudiantes_teacher_select on public.estudiantes;
create policy estudiantes_teacher_select
on public.estudiantes for select to authenticated
using (
  created_by_user_id = auth.uid()
  or private.is_admin()
  or exists (
    select 1
    from public.matriculas m
    join public.cursos c on c.id = m.course_id
    join public.docentes d on d.id = c.docente_id
    where m.student_id = estudiantes.id
      and d.usuario_id = auth.uid()
  )
);

drop policy if exists estudiantes_teacher_insert on public.estudiantes;
create policy estudiantes_teacher_insert
on public.estudiantes for insert to authenticated
with check (
  private.current_app_role() in ('teacher','admin')
  and (created_by_user_id = auth.uid() or private.is_admin())
);

drop policy if exists estudiantes_teacher_update on public.estudiantes;
create policy estudiantes_teacher_update
on public.estudiantes for update to authenticated
using (
  created_by_user_id = auth.uid()
  or private.is_admin()
  or exists (
    select 1
    from public.matriculas m
    join public.cursos c on c.id = m.course_id
    join public.docentes d on d.id = c.docente_id
    where m.student_id = estudiantes.id
      and d.usuario_id = auth.uid()
  )
)
with check (
  created_by_user_id = auth.uid()
  or private.is_admin()
  or exists (
    select 1
    from public.matriculas m
    join public.cursos c on c.id = m.course_id
    join public.docentes d on d.id = c.docente_id
    where m.student_id = estudiantes.id
      and d.usuario_id = auth.uid()
  )
);

-- Cursos
drop policy if exists cursos_teacher_all on public.cursos;
create policy cursos_teacher_all
on public.cursos for all to authenticated
using (private.owns_course(id))
with check (
  docente_id = private.current_teacher_id()
  or private.is_admin()
);

-- Matriculas
drop policy if exists matriculas_teacher_all on public.matriculas;
create policy matriculas_teacher_all
on public.matriculas for all to authenticated
using (private.owns_course(course_id))
with check (private.owns_course(course_id));

-- Bancos
drop policy if exists bancos_teacher_all on public.bancos_preguntas;
create policy bancos_teacher_all
on public.bancos_preguntas for all to authenticated
using (private.owns_course(course_id))
with check (
  private.owns_course(course_id)
  and (owner_user_id = auth.uid() or private.is_admin())
);

-- Preguntas: intentionally no student access
drop policy if exists preguntas_teacher_all on public.preguntas;
create policy preguntas_teacher_all
on public.preguntas for all to authenticated
using (
  exists (
    select 1 from public.bancos_preguntas b
    where b.id = preguntas.bank_id
      and private.owns_course(b.course_id)
  )
)
with check (
  created_by_user_id = auth.uid()
  and exists (
    select 1 from public.bancos_preguntas b
    where b.id = preguntas.bank_id
      and private.owns_course(b.course_id)
  )
  or private.is_admin()
);

drop policy if exists alternativas_teacher_all on public.alternativas;
create policy alternativas_teacher_all
on public.alternativas for all to authenticated
using (
  exists (
    select 1
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    where q.id = alternativas.question_id
      and private.owns_course(b.course_id)
  )
)
with check (
  exists (
    select 1
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    where q.id = alternativas.question_id
      and private.owns_course(b.course_id)
  )
);

-- Exámenes
drop policy if exists examenes_teacher_all on public.examenes;
create policy examenes_teacher_all
on public.examenes for all to authenticated
using (private.owns_exam(id))
with check (
  private.owns_course(course_id)
  and (owner_user_id = auth.uid() or private.is_admin())
);

drop policy if exists configuraciones_teacher_all on public.configuraciones_examen;
create policy configuraciones_teacher_all
on public.configuraciones_examen for all to authenticated
using (private.owns_exam(exam_id))
with check (private.owns_exam(exam_id));

drop policy if exists preguntas_examen_teacher_all on public.preguntas_examen;
create policy preguntas_examen_teacher_all
on public.preguntas_examen for all to authenticated
using (private.owns_exam(exam_id))
with check (
  private.owns_exam(exam_id)
  and exists (
    select 1
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    join public.examenes e on e.id = preguntas_examen.exam_id
    where q.id = preguntas_examen.question_id
      and b.course_id = e.course_id
  )
);

drop policy if exists selection_rules_teacher_all on public.reglas_seleccion_examen;
create policy selection_rules_teacher_all
on public.reglas_seleccion_examen for all to authenticated
using (private.owns_exam(exam_id))
with check (
  private.owns_exam(exam_id)
  and (
    bank_id is null
    or exists (
      select 1
      from public.bancos_preguntas b
      join public.examenes e on e.id = reglas_seleccion_examen.exam_id
      where b.id = reglas_seleccion_examen.bank_id
        and b.course_id = e.course_id
    )
  )
);

-- Intentos and all response data: teacher only for now.
-- Student access will be mediated in Prompt 03/08 instead of exposing tables.
drop policy if exists intentos_teacher_all on public.intentos;
create policy intentos_teacher_all
on public.intentos for all to authenticated
using (private.owns_exam(exam_id))
with check (private.owns_exam(exam_id));

drop policy if exists intento_preguntas_teacher_all on public.intento_preguntas;
create policy intento_preguntas_teacher_all
on public.intento_preguntas for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists respuestas_teacher_all on public.respuestas;
create policy respuestas_teacher_all
on public.respuestas for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists evidencias_teacher_all on public.evidencias;
create policy evidencias_teacher_all
on public.evidencias for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists calificaciones_teacher_all on public.calificaciones;
create policy calificaciones_teacher_all
on public.calificaciones for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists logs_teacher_select on public.logs;
create policy logs_teacher_select
on public.logs for select to authenticated
using (
  private.is_admin()
  or (exam_id is not null and private.owns_exam(exam_id))
  or (attempt_id is not null and private.owns_attempt(attempt_id))
);

drop policy if exists logs_teacher_insert on public.logs;
create policy logs_teacher_insert
on public.logs for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and (
    private.is_admin()
    or exam_id is null
    or private.owns_exam(exam_id)
  )
);

-- Explicit table grants. RLS remains authoritative.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.usuarios,
  public.docentes,
  public.estudiantes,
  public.cursos,
  public.matriculas,
  public.bancos_preguntas,
  public.preguntas,
  public.alternativas,
  public.examenes,
  public.configuraciones_examen,
  public.preguntas_examen,
  public.reglas_seleccion_examen,
  public.intentos,
  public.intento_preguntas,
  public.respuestas,
  public.evidencias,
  public.calificaciones,
  public.logs
to authenticated;

grant usage, select on sequence public.logs_id_seq to authenticated;

-- No grants to anon on protected data tables.
revoke all on
  public.usuarios,
  public.docentes,
  public.estudiantes,
  public.cursos,
  public.matriculas,
  public.bancos_preguntas,
  public.preguntas,
  public.alternativas,
  public.examenes,
  public.configuraciones_examen,
  public.preguntas_examen,
  public.reglas_seleccion_examen,
  public.intentos,
  public.intento_preguntas,
  public.respuestas,
  public.evidencias,
  public.calificaciones,
  public.logs
from anon;


-- The view inherits caller permissions from underlying tables via security_invoker.
revoke all on public.resultados from anon;
revoke all on public.resultados from authenticated;
grant select on public.resultados to authenticated;
-- <<< END MIGRATION: 0006_rls_policies.sql

-- >>> BEGIN MIGRATION: 0007_storage.sql
-- 0007_storage.sql
-- Private buckets and teacher policies. Student uploads are intentionally not opened
-- to anonymous users; Prompt 09 will use a controlled upload mechanism.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'question-media',
    'question-media',
    false,
    10485760,
    array['image/jpeg','image/png','image/webp']
  ),
  (
    'student-evidence',
    'student-evidence',
    false,
    15728640,
    array['image/jpeg','image/png','image/webp','application/pdf']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Recommended object path:
-- question-media/<teacher-user-uuid>/<question-uuid>/<filename>
-- student-evidence/<teacher-user-uuid>/<exam-uuid>/<attempt-uuid>/<filename>

drop policy if exists question_media_teacher_select on storage.objects;
create policy question_media_teacher_select
on storage.objects for select to authenticated
using (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists question_media_teacher_insert on storage.objects;
create policy question_media_teacher_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists question_media_teacher_update on storage.objects;
create policy question_media_teacher_update
on storage.objects for update to authenticated
using (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
)
with check (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists question_media_teacher_delete on storage.objects;
create policy question_media_teacher_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_select on storage.objects;
create policy evidence_teacher_select
on storage.objects for select to authenticated
using (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_insert on storage.objects;
create policy evidence_teacher_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_update on storage.objects;
create policy evidence_teacher_update
on storage.objects for update to authenticated
using (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
)
with check (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_delete on storage.objects;
create policy evidence_teacher_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);
-- <<< END MIGRATION: 0007_storage.sql

-- >>> BEGIN MIGRATION: 0008_integrity_triggers.sql
-- 0008_integrity_triggers.sql
-- Cross-table consistency checks that cannot be expressed with simple CHECK constraints.

create or replace function public.validate_response_attempt_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_attempt uuid;
begin
  select iq.attempt_id
    into expected_attempt
  from public.intento_preguntas iq
  where iq.id = new.attempt_question_id;

  if expected_attempt is null then
    raise exception 'attempt_question_id does not exist';
  end if;

  if new.attempt_id <> expected_attempt then
    raise exception 'response attempt_id does not match attempt_question attempt_id';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_response_attempt_consistency on public.respuestas;
create trigger trg_response_attempt_consistency
before insert or update of attempt_question_id, attempt_id
on public.respuestas
for each row execute function public.validate_response_attempt_consistency();

create or replace function public.validate_evidence_attempt_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_attempt uuid;
begin
  select r.attempt_id
    into expected_attempt
  from public.respuestas r
  where r.id = new.response_id;

  if expected_attempt is null then
    raise exception 'response_id does not exist';
  end if;

  if new.attempt_id <> expected_attempt then
    raise exception 'evidence attempt_id does not match response attempt_id';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_evidence_attempt_consistency on public.evidencias;
create trigger trg_evidence_attempt_consistency
before insert or update of response_id, attempt_id
on public.evidencias
for each row execute function public.validate_evidence_attempt_consistency();

create or replace function public.prevent_attempt_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.exam_id <> old.exam_id
     or new.student_id <> old.student_id
     or new.attempt_number <> old.attempt_number then
    raise exception 'exam_id, student_id and attempt_number are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_attempt_identity_change on public.intentos;
create trigger trg_prevent_attempt_identity_change
before update on public.intentos
for each row execute function public.prevent_attempt_identity_change();
-- <<< END MIGRATION: 0008_integrity_triggers.sql

-- >>> BEGIN MIGRATION: 0009_auth_access.sql
-- 0009_auth_access.sql
-- Prompt 03: teacher authentication support, secure student access and attempt sessions.

alter table public.examenes
  add column if not exists access_code_lookup text;

alter table public.configuraciones_examen
  add column if not exists restrict_to_enrolled_students boolean not null default false;

create unique index if not exists examenes_access_code_lookup_unique
  on public.examenes(access_code_lookup)
  where access_code_lookup is not null and is_deleted = false;

create table if not exists public.student_attempt_sessions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.intentos(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_attempt_sessions_hash_not_blank check (btrim(token_hash) <> '')
);

create index if not exists idx_student_attempt_sessions_expiry
  on public.student_attempt_sessions(expires_at);

alter table public.student_attempt_sessions enable row level security;

revoke all on public.student_attempt_sessions from anon, authenticated;
grant all on public.student_attempt_sessions to service_role;

-- Keep timestamps consistent with the rest of the schema.
drop trigger if exists trg_student_attempt_sessions_updated_at on public.student_attempt_sessions;
create trigger trg_student_attempt_sessions_updated_at
before update on public.student_attempt_sessions
for each row execute function public.set_updated_at();

-- Teachers store access codes as a lookup digest plus a bcrypt-style pgcrypto hash.
-- The function runs with the caller privileges; existing RLS still controls the UPDATE.
create or replace function public.set_exam_access_code(p_exam_id uuid, p_access_code text)
returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  normalized text;
  changed integer;
begin
  normalized := upper(btrim(coalesce(p_access_code, '')));

  if char_length(normalized) < 4 or char_length(normalized) > 64 then
    raise exception 'Access code must contain between 4 and 64 characters';
  end if;

  update public.examenes
  set
    access_code_lookup = encode(extensions.digest(normalized, 'sha256'), 'hex'),
    access_code_hash = extensions.crypt(normalized, extensions.gen_salt('bf', 10)),
    updated_at = now()
  where id = p_exam_id;

  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Exam not found or not accessible';
  end if;
end;
$$;

create or replace function public.clear_exam_access_code(p_exam_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  update public.examenes
  set access_code_lookup = null,
      access_code_hash = null,
      updated_at = now()
  where id = p_exam_id;

  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Exam not found or not accessible';
  end if;
end;
$$;

-- This verifier is reserved for the server-side Edge Function.
-- It is SECURITY INVOKER: the service-role caller supplies its own privileges.
create or replace function public.verify_exam_access_code(p_exam_id uuid, p_access_code text)
returns boolean
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1
    from public.examenes e
    where e.id = p_exam_id
      and e.access_code_hash is not null
      and extensions.crypt(upper(btrim(coalesce(p_access_code, ''))), e.access_code_hash) = e.access_code_hash
  )
$$;

revoke all on function public.set_exam_access_code(uuid, text) from public, anon;
revoke all on function public.clear_exam_access_code(uuid) from public, anon;
revoke all on function public.verify_exam_access_code(uuid, text) from public, anon, authenticated;

grant execute on function public.set_exam_access_code(uuid, text) to authenticated;
grant execute on function public.clear_exam_access_code(uuid) to authenticated;
grant execute on function public.verify_exam_access_code(uuid, text) to service_role;
-- <<< END MIGRATION: 0009_auth_access.sql

-- >>> BEGIN MIGRATION: 0010_exam_management.sql
-- 0010_exam_management.sql
-- Prompt 04: teacher exam lifecycle, target question count and safe duplication.

alter table public.configuraciones_examen
  add column if not exists target_question_count integer not null default 20;

do $$ begin
  alter table public.configuraciones_examen
    add constraint config_target_question_count_positive check (target_question_count > 0);
exception when duplicate_object then null; end $$;

-- Prevent incomplete exams from being published. Draft/closed/archived exams remain editable.
create or replace function public.validate_exam_publishable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cfg public.configuraciones_examen%rowtype;
begin
  if new.status in ('scheduled', 'active') then
    if new.is_deleted then
      raise exception 'A deleted exam cannot be scheduled or activated';
    end if;

    if new.access_code_hash is null or new.access_code_lookup is null then
      raise exception 'Configure an access code before scheduling or activating the exam';
    end if;

    if new.starts_at is null or new.ends_at is null then
      raise exception 'Configure a start and end date before scheduling or activating the exam';
    end if;

    if new.ends_at <= new.starts_at then
      raise exception 'The exam end date must be later than the start date';
    end if;

    if new.ends_at <= now() then
      raise exception 'The exam end date must be in the future';
    end if;

    select * into cfg
    from public.configuraciones_examen
    where exam_id = new.id;

    if not found then
      raise exception 'The exam does not have a configuration';
    end if;

    if cfg.duration_minutes <= 0 then
      raise exception 'The exam duration must be greater than zero';
    end if;

    if cfg.target_question_count <= 0 then
      raise exception 'The target question count must be greater than zero';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_exam_publishable on public.examenes;
create trigger trg_validate_exam_publishable
before insert or update on public.examenes
for each row execute function public.validate_exam_publishable();

-- Duplicate an exam atomically. Access code, schedule, attempts and results are intentionally not copied.
create or replace function public.duplicate_exam(p_exam_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  src public.examenes%rowtype;
  new_exam_id uuid;
begin
  select * into src
  from public.examenes
  where id = p_exam_id
    and is_deleted = false;

  if not found then
    raise exception 'Exam not found or not accessible';
  end if;

  insert into public.examenes (
    course_id,
    owner_user_id,
    title,
    description,
    instructions,
    access_code_hash,
    access_code_lookup,
    access_code_hint,
    starts_at,
    ends_at,
    status,
    is_deleted
  ) values (
    src.course_id,
    auth.uid(),
    src.title || ' (copia)',
    src.description,
    src.instructions,
    null,
    null,
    null,
    null,
    null,
    'draft',
    false
  )
  returning id into new_exam_id;

  insert into public.configuraciones_examen (
    exam_id,
    duration_minutes,
    max_attempts,
    target_question_count,
    randomize_questions,
    randomize_options,
    navigation,
    allow_backtrack,
    auto_submit_on_timeout,
    result_visibility,
    show_results_after,
    require_student_code,
    require_first_name,
    require_last_name,
    require_email,
    require_section,
    restrict_to_enrolled_students,
    grade_scale_max,
    passing_grade,
    settings
  )
  select
    new_exam_id,
    duration_minutes,
    max_attempts,
    target_question_count,
    randomize_questions,
    randomize_options,
    navigation,
    allow_backtrack,
    auto_submit_on_timeout,
    result_visibility,
    null,
    require_student_code,
    require_first_name,
    require_last_name,
    require_email,
    require_section,
    restrict_to_enrolled_students,
    grade_scale_max,
    passing_grade,
    settings
  from public.configuraciones_examen
  where exam_id = p_exam_id;

  insert into public.preguntas_examen (
    exam_id, question_id, fixed_position, points_override, is_required
  )
  select
    new_exam_id, question_id, fixed_position, points_override, is_required
  from public.preguntas_examen
  where exam_id = p_exam_id;

  insert into public.reglas_seleccion_examen (
    exam_id,
    bank_id,
    unit,
    topic,
    subtopic,
    difficulty,
    question_type,
    quantity,
    rule_order,
    points_override,
    metadata
  )
  select
    new_exam_id,
    bank_id,
    unit,
    topic,
    subtopic,
    difficulty,
    question_type,
    quantity,
    rule_order,
    points_override,
    metadata
  from public.reglas_seleccion_examen
  where exam_id = p_exam_id;

  return new_exam_id;
end;
$$;

revoke all on function public.duplicate_exam(uuid) from public, anon;
grant execute on function public.duplicate_exam(uuid) to authenticated;
-- <<< END MIGRATION: 0010_exam_management.sql

-- >>> BEGIN MIGRATION: 0011_question_bank_management.sql
-- 0011_question_bank_management.sql
-- Question-bank enhancements for reusable cases and integrity.

alter table public.preguntas
  add column if not exists parent_question_id uuid references public.preguntas(id) on delete cascade,
  add column if not exists case_position integer;

alter table public.preguntas drop constraint if exists preguntas_case_position_positive;
alter table public.preguntas add constraint preguntas_case_position_positive
  check (case_position is null or case_position > 0);

create index if not exists preguntas_bank_parent_idx on public.preguntas(bank_id, parent_question_id, is_active);
create index if not exists preguntas_taxonomy_idx on public.preguntas(bank_id, unit, topic, subtopic, difficulty, type);
create unique index if not exists preguntas_case_position_unique
  on public.preguntas(parent_question_id, case_position)
  where parent_question_id is not null and case_position is not null;

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
  if new.case_position is null then raise exception 'Las subpreguntas requieren una posición.'; end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_question_hierarchy on public.preguntas;
create trigger trg_validate_question_hierarchy
before insert or update of parent_question_id, bank_id, type, case_position
on public.preguntas
for each row execute function private.validate_question_hierarchy();

create or replace function private.validate_alternative_question_type()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_type public.question_type;
begin
  select type into v_type from public.preguntas where id = new.question_id;
  if v_type not in ('single_choice'::public.question_type,'multiple_choice'::public.question_type,'image_single_choice'::public.question_type) then
    raise exception 'Este tipo de pregunta no admite alternativas almacenadas.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_alternative_question_type on public.alternativas;
create trigger trg_validate_alternative_question_type
before insert or update of question_id on public.alternativas
for each row execute function private.validate_alternative_question_type();

-- Avoid silently moving a populated bank to another course, which could invalidate
-- exam/question relationships already created in the original course.
create or replace function private.prevent_populated_bank_course_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.course_id is distinct from old.course_id
     and exists (select 1 from public.preguntas q where q.bank_id = old.id) then
    raise exception 'No se puede cambiar de curso un banco que ya contiene preguntas.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_populated_bank_course_change on public.bancos_preguntas;
create trigger trg_prevent_populated_bank_course_change
before update of course_id on public.bancos_preguntas
for each row execute function private.prevent_populated_bank_course_change();

-- A question already incorporated into an exam must not be moved to another bank,
-- because the target bank may belong to a different course.
create or replace function private.prevent_used_question_bank_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.bank_id is distinct from old.bank_id
     and (
       exists (select 1 from public.preguntas_examen pe where pe.question_id = old.id)
       or exists (select 1 from public.intento_preguntas ip where ip.question_id = old.id)
     ) then
    raise exception 'No se puede mover de banco una pregunta que ya está vinculada a un examen.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_used_question_bank_change on public.preguntas;
create trigger trg_prevent_used_question_bank_change
before update of bank_id on public.preguntas
for each row execute function private.prevent_used_question_bank_change();
-- <<< END MIGRATION: 0011_question_bank_management.sql

-- >>> BEGIN MIGRATION: 0012_exam_randomization_engine.sql
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
-- <<< END MIGRATION: 0012_exam_randomization_engine.sql

-- >>> BEGIN MIGRATION: 0013_exam_runtime_engine.sql
-- 0013_exam_runtime_engine.sql
-- Prompt 08: runtime navigation state and conflict-safe autosave revisions.

alter table public.intentos
  add column if not exists current_question_order integer not null default 1,
  add column if not exists max_question_order_reached integer not null default 1,
  add column if not exists last_server_sync_at timestamptz;

alter table public.respuestas
  add column if not exists client_revision bigint not null default 0;

do $$ begin
  alter table public.intentos
    add constraint intentos_current_question_order_positive
    check (current_question_order > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.intentos
    add constraint intentos_max_question_order_positive
    check (max_question_order_reached > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.respuestas
    add constraint respuestas_client_revision_nonnegative
    check (client_revision >= 0);
exception when duplicate_object then null; end $$;

create index if not exists respuestas_attempt_id_idx on public.respuestas(attempt_id);
create index if not exists respuestas_attempt_answered_idx on public.respuestas(attempt_id, is_answered);
create index if not exists intentos_status_deadline_idx on public.intentos(status, deadline_at);

-- Existing active attempts should start from a valid navigation position.
update public.intentos
set current_question_order = greatest(coalesce(current_question_order, 1), 1),
    max_question_order_reached = greatest(coalesce(max_question_order_reached, 1), 1)
where current_question_order is null
   or max_question_order_reached is null
   or current_question_order < 1
   or max_question_order_reached < 1;
-- <<< END MIGRATION: 0013_exam_runtime_engine.sql

-- >>> BEGIN MIGRATION: 0014_evidence_uploads.sql
-- 0014_evidence_uploads.sql
-- Controlled student evidence uploads and traceability.

alter table public.evidencias
  add column if not exists attempt_question_id uuid references public.intento_preguntas(id) on delete cascade;

update public.evidencias e
set attempt_question_id = r.attempt_question_id
from public.respuestas r
where e.response_id = r.id
  and e.attempt_question_id is null;

create index if not exists idx_evidencias_attempt_question
  on public.evidencias(attempt_question_id)
  where deleted_at is null;

create unique index if not exists uq_evidencia_activa_por_pregunta
  on public.evidencias(attempt_question_id)
  where deleted_at is null and attempt_question_id is not null;

create table if not exists public.cargas_evidencia_temporales (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.intentos(id) on delete cascade,
  attempt_question_id uuid not null references public.intento_preguntas(id) on delete cascade,
  object_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cargas_evidencia_size check (size_bytes > 0 and size_bytes <= 15728640),
  constraint cargas_evidencia_filename check (btrim(original_filename) <> ''),
  constraint cargas_evidencia_path check (btrim(object_path) <> ''),
  constraint cargas_evidencia_mime check (
    mime_type in ('image/jpeg','image/png','image/webp','application/pdf')
  )
);

create index if not exists idx_cargas_evidencia_attempt
  on public.cargas_evidencia_temporales(attempt_id, created_at desc);
create index if not exists idx_cargas_evidencia_expiry
  on public.cargas_evidencia_temporales(expires_at)
  where finalized_at is null;

alter table public.cargas_evidencia_temporales enable row level security;

drop policy if exists cargas_evidencia_teacher_select on public.cargas_evidencia_temporales;
create policy cargas_evidencia_teacher_select
on public.cargas_evidencia_temporales for select to authenticated
using (private.owns_attempt(attempt_id));

-- Edge Functions use the service role for insert/update. Teachers only require read access.

create or replace function private.validate_evidence_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_question_id uuid;
begin
  select r.attempt_id, r.attempt_question_id
  into v_attempt_id, v_question_id
  from public.respuestas r
  where r.id = new.response_id;

  if v_attempt_id is null then
    raise exception 'Evidence response does not exist';
  end if;

  if new.attempt_id <> v_attempt_id then
    raise exception 'Evidence attempt does not match response';
  end if;

  if new.attempt_question_id is null then
    new.attempt_question_id := v_question_id;
  elsif new.attempt_question_id <> v_question_id then
    raise exception 'Evidence question does not match response';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_evidence_consistency() from public;

drop trigger if exists trg_validate_evidence_consistency on public.evidencias;
create trigger trg_validate_evidence_consistency
before insert or update of response_id, attempt_id, attempt_question_id
on public.evidencias
for each row execute function private.validate_evidence_consistency();

-- Keep teacher grants aligned with existing tables.
grant select on public.cargas_evidencia_temporales to authenticated;

-- Permit an authenticated teacher to open evidence whenever RLS says the attempt
-- belongs to them, even if the file was originally stored under another owner UUID.
drop policy if exists evidence_teacher_select_by_attempt on storage.objects;
create policy evidence_teacher_select_by_attempt
on storage.objects for select to authenticated
using (
  bucket_id = 'student-evidence'
  and exists (
    select 1
    from public.evidencias e
    where e.bucket_name = bucket_id
      and e.object_path = name
      and e.deleted_at is null
      and private.owns_attempt(e.attempt_id)
  )
);
-- <<< END MIGRATION: 0014_evidence_uploads.sql

-- >>> BEGIN MIGRATION: 0015_auto_grading_engine.sql
-- 0015_auto_grading_engine.sql
-- Prompt 10: deterministic server-side automatic grading.

alter table public.respuestas
  add column if not exists auto_grading_details jsonb not null default '{}'::jsonb,
  add column if not exists auto_graded_at timestamptz,
  add column if not exists auto_grading_version integer;

alter table public.calificaciones
  add column if not exists pending_manual_reviews integer not null default 0,
  add column if not exists auto_graded_at timestamptz,
  add column if not exists auto_grading_version integer;

do $$ begin
  alter table public.respuestas
    add constraint respuestas_auto_grading_version_positive
    check (auto_grading_version is null or auto_grading_version > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.calificaciones
    add constraint calificaciones_pending_manual_nonnegative
    check (pending_manual_reviews >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.calificaciones
    add constraint calificaciones_auto_grading_version_positive
    check (auto_grading_version is null or auto_grading_version > 0);
exception when duplicate_object then null; end $$;

create or replace function private.jsonb_text_array_set_equal(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce((
    select array_agg(distinct value order by value)
    from jsonb_array_elements_text(coalesce(p_left, '[]'::jsonb)) value
  ), array[]::text[])
  = coalesce((
    select array_agg(distinct value order by value)
    from jsonb_array_elements_text(coalesce(p_right, '[]'::jsonb)) value
  ), array[]::text[]);
$$;

create or replace function private.normalize_grade_text(p_value text, p_config jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v text := coalesce(p_value, '');
  v_mode text := coalesce(p_config->>'mode', 'case_insensitive');
  v_trim boolean := coalesce((p_config->>'trimWhitespace')::boolean, true);
  v_collapse boolean := coalesce((p_config->>'collapseWhitespace')::boolean, false);
begin
  if v_trim then
    v := btrim(v);
  end if;
  if v_collapse then
    v := regexp_replace(v, '[[:space:]]+', ' ', 'g');
  end if;
  if v_mode = 'case_insensitive' then
    v := lower(v);
  end if;
  return v;
end;
$$;

create or replace function private.answer_json_present(p_type public.question_type, p_answer jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb := coalesce(p_answer->'answerPayload', '{}'::jsonb);
begin
  if p_type in ('single_choice'::public.question_type, 'image_single_choice'::public.question_type, 'multiple_choice'::public.question_type) then
    return jsonb_array_length(coalesce(p_answer->'selectedOptionIds', '[]'::jsonb)) > 0;
  elsif p_type = 'true_false'::public.question_type then
    return v_payload ? 'value' and jsonb_typeof(v_payload->'value') = 'boolean';
  elsif p_type in ('numeric'::public.question_type, 'calculation'::public.question_type) then
    return p_answer ? 'answerNumeric' and p_answer->'answerNumeric' <> 'null'::jsonb;
  elsif p_type = 'calculation_evidence'::public.question_type then
    return p_answer ? 'answerNumeric'
      and p_answer->'answerNumeric' <> 'null'::jsonb
      and coalesce((v_payload->>'evidenceCount')::integer, 0) > 0;
  elsif p_type in ('short_text'::public.question_type, 'essay'::public.question_type, 'image_essay'::public.question_type) then
    return btrim(coalesce(p_answer->>'answerText', '')) <> '';
  elsif p_type = 'attachment'::public.question_type then
    return coalesce((v_payload->>'evidenceCount')::integer, 0) > 0;
  end if;
  return false;
end;
$$;

create or replace function private.grade_auto_item(
  p_type public.question_type,
  p_points numeric,
  p_grading jsonb,
  p_answer_text text,
  p_answer_numeric numeric,
  p_selected_option_ids jsonb,
  p_answer_payload jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  v_points numeric := greatest(coalesce(p_points, 0), 0);
  v_answer_key jsonb := coalesce(p_grading->'answerKey', '{}'::jsonb);
  v_config jsonb := coalesce(p_grading->'gradingConfig', '{}'::jsonb);
  v_correct boolean := false;
  v_score numeric := 0;
  v_target numeric;
  v_tolerance numeric;
  v_min numeric;
  v_max numeric;
  v_numeric_mode text;
  v_candidate text;
  v_accepted text;
  v_manual boolean := false;
begin
  if p_type in ('essay'::public.question_type, 'image_essay'::public.question_type, 'attachment'::public.question_type) then
    return jsonb_build_object('isCorrect', null, 'autoScore', 0, 'needsManual', true, 'method', 'manual');
  end if;

  if p_type in ('single_choice'::public.question_type, 'image_single_choice'::public.question_type, 'multiple_choice'::public.question_type) then
    v_correct := private.jsonb_text_array_set_equal(
      coalesce(p_selected_option_ids, '[]'::jsonb),
      coalesce(p_grading->'correctOptionIds', '[]'::jsonb)
    );
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object('isCorrect', v_correct, 'autoScore', v_score, 'needsManual', false, 'method', 'options_exact_set');
  end if;

  if p_type = 'true_false'::public.question_type then
    v_correct := (coalesce(p_answer_payload, '{}'::jsonb)->'value') = (v_answer_key->'value')
      and (coalesce(p_answer_payload, '{}'::jsonb) ? 'value');
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object('isCorrect', v_correct, 'autoScore', v_score, 'needsManual', false, 'method', 'boolean');
  end if;

  if p_type = 'short_text'::public.question_type then
    v_candidate := private.normalize_grade_text(p_answer_text, v_config);
    v_correct := false;
    for v_accepted in select value from jsonb_array_elements_text(coalesce(v_answer_key->'answers', '[]'::jsonb)) value loop
      if v_candidate = private.normalize_grade_text(v_accepted, v_config) then
        v_correct := true;
        exit;
      end if;
    end loop;
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object('isCorrect', v_correct, 'autoScore', v_score, 'needsManual', false, 'method', coalesce(v_config->>'mode', 'case_insensitive'));
  end if;

  if p_type in ('numeric'::public.question_type, 'calculation'::public.question_type, 'calculation_evidence'::public.question_type) then
    v_numeric_mode := coalesce(v_config->>'numericMode',
      case
        when v_answer_key ? 'min' or v_answer_key ? 'max' then 'range'
        when p_grading->>'numericTolerance' is not null then 'tolerance'
        else 'exact'
      end
    );

    if p_answer_numeric is null then
      v_correct := false;
    elsif v_numeric_mode = 'range' then
      v_min := nullif(coalesce(v_config->>'min', v_answer_key->>'min'), '')::numeric;
      v_max := nullif(coalesce(v_config->>'max', v_answer_key->>'max'), '')::numeric;
      v_correct := v_min is not null and v_max is not null and p_answer_numeric between v_min and v_max;
    else
      v_target := nullif(v_answer_key->>'value', '')::numeric;
      if v_numeric_mode = 'tolerance' then
        v_tolerance := greatest(coalesce(nullif(p_grading->>'numericTolerance', '')::numeric, 0), 0);
        v_correct := v_target is not null and abs(p_answer_numeric - v_target) <= v_tolerance;
      else
        v_correct := v_target is not null and p_answer_numeric = v_target;
      end if;
    end if;

    v_manual := p_type = 'calculation_evidence'::public.question_type;
    if v_manual and coalesce((coalesce(p_answer_payload, '{}'::jsonb)->>'evidenceCount')::integer, 0) <= 0 then
      v_correct := false;
    end if;
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object(
      'isCorrect', v_correct,
      'autoScore', v_score,
      'needsManual', v_manual,
      'method', v_numeric_mode
    );
  end if;

  return jsonb_build_object('isCorrect', null, 'autoScore', 0, 'needsManual', true, 'method', 'manual_fallback');
end;
$$;

create or replace function private.auto_grade_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_attempt public.intentos%rowtype;
  v_config public.configuraciones_examen%rowtype;
  v_question record;
  v_response public.respuestas%rowtype;
  v_grade jsonb;
  v_details jsonb;
  v_review public.review_status;
  v_auto numeric;
  v_is_correct boolean;
  v_child_display jsonb;
  v_child_grade jsonb;
  v_child_answer jsonb;
  v_child_result jsonb;
  v_case_auto numeric;
  v_case_manual_pending boolean;
  v_case_has_manual boolean;
  v_case_all_auto_correct boolean;
  v_case_has_auto boolean;
  v_case_details jsonb;
  v_total_auto numeric;
  v_total_manual numeric;
  v_total_max numeric;
  v_pending integer;
  v_raw numeric;
  v_scale numeric;
  v_final numeric;
  v_now timestamptz := now();
  v_version integer := 1;
begin
  select * into v_attempt from public.intentos where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status not in ('submitted'::public.attempt_status, 'time_expired'::public.attempt_status) then
    raise exception 'ATTEMPT_NOT_CLOSED';
  end if;

  select * into v_config from public.configuraciones_examen where exam_id = v_attempt.exam_id;
  if not found then raise exception 'EXAM_CONFIGURATION_NOT_FOUND'; end if;

  for v_question in
    select q.*
    from public.intento_preguntas q
    where q.attempt_id = p_attempt_id
    order by q.display_order
  loop
    select * into v_response
    from public.respuestas
    where attempt_question_id = v_question.id;

    if not found then
      insert into public.respuestas(
        attempt_question_id, attempt_id, selected_option_ids, answer_payload,
        is_answered, review_status, client_revision, last_saved_at
      ) values (
        v_question.id, p_attempt_id, '[]'::jsonb, '{}'::jsonb,
        false, 'not_required'::public.review_status, 0, v_now
      ) returning * into v_response;
    end if;

    if v_question.question_type = 'case_group'::public.question_type then
      v_case_auto := 0;
      v_case_manual_pending := false;
      v_case_has_manual := false;
      v_case_all_auto_correct := true;
      v_case_has_auto := false;
      v_case_details := '[]'::jsonb;

      for v_child_display in
        select value from jsonb_array_elements(coalesce(v_question.metadata_snapshot->'caseSubquestions', '[]'::jsonb))
      loop
        select value into v_child_grade
        from jsonb_array_elements(coalesce(v_question.grading_snapshot->'caseSubquestions', '[]'::jsonb)) value
        where value->>'id' = v_child_display->>'id'
        limit 1;

        v_child_answer := coalesce(v_response.answer_payload->'caseAnswers'->(v_child_display->>'id'), '{}'::jsonb);
        v_child_result := private.grade_auto_item(
          (v_child_display->>'type')::public.question_type,
          coalesce((v_child_display->>'points')::numeric, 0),
          coalesce(v_child_grade->'grading', '{}'::jsonb),
          v_child_answer->>'answerText',
          nullif(v_child_answer->>'answerNumeric', '')::numeric,
          coalesce(v_child_answer->'selectedOptionIds', '[]'::jsonb),
          coalesce(v_child_answer->'answerPayload', '{}'::jsonb)
        );

        v_case_auto := v_case_auto + coalesce((v_child_result->>'autoScore')::numeric, 0);
        if coalesce((v_child_result->>'needsManual')::boolean, false) then
          v_case_has_manual := true;
          if private.answer_json_present((v_child_display->>'type')::public.question_type, v_child_answer) then
            v_case_manual_pending := true;
          end if;
        end if;
        if not coalesce((v_child_result->>'needsManual')::boolean, false) then
          v_case_has_auto := true;
          if not coalesce((v_child_result->>'isCorrect')::boolean, false) then
            v_case_all_auto_correct := false;
          end if;
        end if;

        v_case_details := v_case_details || jsonb_build_array(jsonb_build_object(
          'childId', v_child_display->>'id',
          'type', v_child_display->>'type',
          'points', coalesce((v_child_display->>'points')::numeric, 0),
          'isAnswered', private.answer_json_present((v_child_display->>'type')::public.question_type, v_child_answer),
          'isCorrect', v_child_result->'isCorrect',
          'autoScore', v_child_result->'autoScore',
          'needsManual', v_child_result->'needsManual',
          'method', v_child_result->'method'
        ));
      end loop;

      v_auto := least(v_case_auto, v_question.points_snapshot);
      v_review := case when v_case_manual_pending then 'pending'::public.review_status else 'not_required'::public.review_status end;
      v_is_correct := case when v_case_has_manual or not v_case_has_auto then null else v_case_all_auto_correct end;
      v_details := jsonb_build_object('type', 'case_group', 'children', v_case_details, 'version', v_version);
    else
      v_grade := private.grade_auto_item(
        v_question.question_type,
        v_question.points_snapshot,
        v_question.grading_snapshot,
        v_response.answer_text,
        v_response.answer_numeric,
        v_response.selected_option_ids,
        v_response.answer_payload
      );
      v_auto := least(greatest(coalesce((v_grade->>'autoScore')::numeric, 0), 0), v_question.points_snapshot);
      v_is_correct := case when v_grade->'isCorrect' = 'null'::jsonb then null else (v_grade->>'isCorrect')::boolean end;
      v_review := case
        when coalesce((v_grade->>'needsManual')::boolean, false) and v_response.is_answered
          then 'pending'::public.review_status
        else 'not_required'::public.review_status
      end;
      v_details := jsonb_build_object(
        'type', v_question.question_type,
        'method', v_grade->>'method',
        'needsManual', coalesce((v_grade->>'needsManual')::boolean, false),
        'version', v_version
      );
    end if;

    update public.respuestas
    set
      is_correct = v_is_correct,
      auto_score = v_auto,
      review_status = v_review,
      auto_grading_details = v_details,
      auto_graded_at = v_now,
      auto_grading_version = v_version,
      updated_at = v_now
    where id = v_response.id;
  end loop;

  select
    coalesce(sum(coalesce(r.auto_score, 0)), 0),
    coalesce(sum(coalesce(r.manual_score, 0)), 0),
    coalesce(sum(q.points_snapshot), 0),
    count(*) filter (where r.review_status = 'pending'::public.review_status)
  into v_total_auto, v_total_manual, v_total_max, v_pending
  from public.intento_preguntas q
  left join public.respuestas r on r.attempt_question_id = q.id
  where q.attempt_id = p_attempt_id;

  v_raw := least(v_total_auto + v_total_manual, v_total_max);
  v_scale := coalesce(nullif(v_attempt.frozen_exam_config->>'gradeScaleMax', '')::numeric, v_config.grade_scale_max);
  v_final := case
    when v_pending = 0 and v_total_max > 0 then round((v_raw / v_total_max) * v_scale, 3)
    when v_pending = 0 and v_total_max = 0 then 0
    else null
  end;

  insert into public.calificaciones(
    attempt_id, auto_score, manual_score, raw_score, max_raw_score,
    final_grade, pending_manual_reviews, auto_graded_at, auto_grading_version,
    graded_at, updated_at
  ) values (
    p_attempt_id, v_total_auto, v_total_manual, v_raw, v_total_max,
    v_final, v_pending, v_now, v_version,
    case when v_pending = 0 then v_now else null end, v_now
  )
  on conflict (attempt_id) do update set
    auto_score = excluded.auto_score,
    manual_score = excluded.manual_score,
    raw_score = excluded.raw_score,
    max_raw_score = excluded.max_raw_score,
    final_grade = excluded.final_grade,
    pending_manual_reviews = excluded.pending_manual_reviews,
    auto_graded_at = excluded.auto_graded_at,
    auto_grading_version = excluded.auto_grading_version,
    graded_at = case when excluded.pending_manual_reviews = 0 then excluded.auto_graded_at else calificaciones.graded_at end,
    updated_at = excluded.updated_at;

  insert into public.logs(student_id, exam_id, attempt_id, event_type, metadata)
  values (
    v_attempt.student_id,
    v_attempt.exam_id,
    p_attempt_id,
    'AUTO_GRADING_COMPLETED',
    jsonb_build_object(
      'version', v_version,
      'autoScore', v_total_auto,
      'manualScore', v_total_manual,
      'rawScore', v_raw,
      'maxRawScore', v_total_max,
      'pendingManualReviews', v_pending,
      'finalGrade', v_final
    )
  );

  return jsonb_build_object(
    'attemptId', p_attempt_id,
    'autoScore', v_total_auto,
    'manualScore', v_total_manual,
    'rawScore', v_raw,
    'maxRawScore', v_total_max,
    'pendingManualReviews', v_pending,
    'finalGrade', v_final,
    'version', v_version
  );
end;
$$;

create or replace function private.trigger_auto_grade_attempt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.status in ('submitted'::public.attempt_status, 'time_expired'::public.attempt_status)
     and old.status is distinct from new.status then
    begin
      perform private.auto_grade_attempt(new.id);
    exception when others then
      -- Closing the student's attempt must not fail only because grading encountered an error.
      begin
        insert into public.logs(student_id, exam_id, attempt_id, event_type, metadata)
        values (new.student_id, new.exam_id, new.id, 'AUTO_GRADING_FAILED', jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm));
      exception when others then
        null;
      end;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_grade_attempt on public.intentos;
create trigger trg_auto_grade_attempt
after update of status on public.intentos
for each row execute function private.trigger_auto_grade_attempt();

-- Internal grading details and frozen keys remain inaccessible to student-facing roles.
revoke all on function private.jsonb_text_array_set_equal(jsonb, jsonb) from public;
revoke all on function private.normalize_grade_text(text, jsonb) from public;
revoke all on function private.answer_json_present(public.question_type, jsonb) from public;
revoke all on function private.auto_grade_attempt(uuid) from public;
revoke all on function private.grade_auto_item(public.question_type, numeric, jsonb, text, numeric, jsonb, jsonb) from public;
revoke all on function private.trigger_auto_grade_attempt() from public;
-- <<< END MIGRATION: 0015_auto_grading_engine.sql

-- >>> BEGIN MIGRATION: 0016_manual_grading_rubrics.sql
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
-- <<< END MIGRATION: 0016_manual_grading_rubrics.sql

-- >>> BEGIN MIGRATION: 0017_results_analytics.sql
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
-- <<< END MIGRATION: 0017_results_analytics.sql

-- >>> BEGIN MIGRATION: 0018_results_export.sql
-- 0018_results_export.sql
-- Prompt 13: secure detailed rows used by Excel/CSV exports.

create or replace function public.get_exam_export_details(p_exam_id uuid)
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

  with rows as (
    select
      i.id as attempt_id,
      i.attempt_number,
      i.status,
      s.student_code,
      s.first_name,
      s.last_name,
      s.email,
      s.section,
      q.id as attempt_question_id,
      q.display_order,
      q.question_type,
      q.prompt_snapshot,
      q.points_snapshot,
      q.options_snapshot,
      q.grading_snapshot,
      q.metadata_snapshot,
      r.id as response_id,
      r.answer_text,
      r.answer_numeric,
      r.selected_option_ids,
      r.answer_payload,
      coalesce(r.is_answered, false) as is_answered,
      r.is_correct,
      r.auto_score,
      r.manual_score,
      r.review_status,
      r.teacher_feedback,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'filename', e.original_filename,
          'mimeType', e.mime_type,
          'sizeBytes', e.size_bytes
        ) order by e.uploaded_at)
        from public.evidencias e
        where e.response_id = r.id
          and e.deleted_at is null
      ), '[]'::jsonb) as evidence_files
    from public.intentos i
    join public.estudiantes s on s.id = i.student_id
    join public.intento_preguntas q on q.attempt_id = i.id
    left join public.respuestas r on r.attempt_question_id = q.id
    where i.exam_id = p_exam_id
      and i.status <> 'cancelled'::public.attempt_status
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'attemptId', attempt_id,
      'attemptNumber', attempt_number,
      'status', status::text,
      'studentCode', student_code,
      'firstName', first_name,
      'lastName', last_name,
      'email', email,
      'section', section,
      'questionOrder', display_order,
      'type', question_type::text,
      'prompt', prompt_snapshot,
      'points', points_snapshot,
      'options', options_snapshot,
      'grading', grading_snapshot,
      'metadata', metadata_snapshot,
      'answerText', answer_text,
      'answerNumeric', answer_numeric,
      'selectedOptionIds', selected_option_ids,
      'answerPayload', answer_payload,
      'isAnswered', is_answered,
      'isCorrect', is_correct,
      'autoScore', auto_score,
      'manualScore', manual_score,
      'effectiveScore', case
        when review_status = 'reviewed'::public.review_status then coalesce(manual_score, 0)
        else coalesce(auto_score, 0)
      end,
      'reviewStatus', coalesce(review_status::text, 'not_required'),
      'teacherFeedback', teacher_feedback,
      'evidenceFiles', evidence_files
    ) order by lower(last_name), lower(first_name), attempt_number, display_order
  ), '[]'::jsonb)
  into v_result
  from rows;

  return v_result;
end;
$$;

revoke all on function public.get_exam_export_details(uuid) from public;
grant execute on function public.get_exam_export_details(uuid) to authenticated;
-- <<< END MIGRATION: 0018_results_export.sql

-- >>> BEGIN MIGRATION: 0019_security_hardening.sql
-- 0019_security_hardening.sql
-- Prompt 14: security and integrity hardening.

-- Harden exposed schema against search_path object shadowing by client roles.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

-- 1) Ownership helpers require an active teacher/admin account, not merely a valid JWT.
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
    and u.role in ('teacher'::public.app_role, 'admin'::public.app_role)
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
    join public.usuarios u on u.id = d.usuario_id
    where c.id = p_course_id
      and d.usuario_id = auth.uid()
      and u.is_active = true
      and u.role in ('teacher'::public.app_role, 'admin'::public.app_role)
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
    join public.usuarios u on u.id = auth.uid()
    where e.id = p_exam_id
      and u.is_active = true
      and u.role in ('teacher'::public.app_role, 'admin'::public.app_role)
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

-- 2) Server-only rate limiting state for the anonymous student Edge Function.
create table if not exists public.edge_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  constraint edge_rate_limits_count_nonnegative check (request_count >= 0),
  constraint edge_rate_limits_key_not_blank check (btrim(key_hash) <> '')
);

alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.edge_rate_limits to service_role;

create index if not exists idx_edge_rate_limits_updated_at on public.edge_rate_limits(updated_at);

create or replace function public.consume_edge_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.edge_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_key_hash is null or btrim(p_key_hash) = '' then return false; end if;
  if p_limit < 1 or p_window_seconds < 1 then return false; end if;

  insert into public.edge_rate_limits(key_hash, window_started_at, request_count, updated_at)
  values (p_key_hash, v_now, 0, v_now)
  on conflict (key_hash) do nothing;

  select * into v_row
  from public.edge_rate_limits
  where key_hash = p_key_hash
  for update;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.edge_rate_limits
    set window_started_at = v_now, request_count = 1, updated_at = v_now
    where key_hash = p_key_hash;
    return true;
  end if;

  if v_row.request_count >= p_limit then
    update public.edge_rate_limits set updated_at = v_now where key_hash = p_key_hash;
    return false;
  end if;

  update public.edge_rate_limits
  set request_count = request_count + 1, updated_at = v_now
  where key_hash = p_key_hash;
  return true;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, integer, integer) to service_role;

-- 3) Explicit grants/revokes on tables added after the original RLS migration.
revoke all on public.cargas_evidencia_temporales from anon;
revoke all on public.rubricas, public.rubrica_criterios from anon;

-- 4) Storage: only active teachers/admins can manipulate question media.
drop policy if exists question_media_teacher_select on storage.objects;
create policy question_media_teacher_select
on storage.objects for select to authenticated
using (
  bucket_id = 'question-media'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin())
);

drop policy if exists question_media_teacher_insert on storage.objects;
create policy question_media_teacher_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'question-media'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin())
);

drop policy if exists question_media_teacher_update on storage.objects;
create policy question_media_teacher_update
on storage.objects for update to authenticated
using (
  bucket_id = 'question-media'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin())
)
with check (
  bucket_id = 'question-media'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin())
);

drop policy if exists question_media_teacher_delete on storage.objects;
create policy question_media_teacher_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'question-media'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin())
);

-- Student evidence is written/deleted by the controlled Edge Function using service_role.
-- Authenticated teachers need read-only access for grading/review.
drop policy if exists evidence_teacher_insert on storage.objects;
drop policy if exists evidence_teacher_update on storage.objects;
drop policy if exists evidence_teacher_delete on storage.objects;

drop policy if exists evidence_teacher_select on storage.objects;
create policy evidence_teacher_select
on storage.objects for select to authenticated
using (
  bucket_id = 'student-evidence'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin())
);

drop policy if exists evidence_teacher_select_by_attempt on storage.objects;
create policy evidence_teacher_select_by_attempt
on storage.objects for select to authenticated
using (
  bucket_id = 'student-evidence'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
  and exists (
    select 1
    from public.evidencias e
    where e.bucket_name = bucket_id
      and e.object_path = name
      and e.deleted_at is null
      and private.owns_attempt(e.attempt_id)
  )
);

-- 5) Analytics/export do not require definer privileges: RLS already grants owners the data.
alter function public.get_exam_overview(uuid) security invoker;
alter function public.get_exam_question_analytics(uuid) security invoker;
alter function public.get_exam_student_results(uuid) security invoker;
alter function public.get_exam_export_details(uuid) security invoker;
-- <<< END MIGRATION: 0019_security_hardening.sql

-- >>> BEGIN MIGRATION: 0020_failure_recovery.sql
-- 0020_failure_recovery.sql
-- Prompt 15: controlled failure recovery without reopening or extending exam time.

alter table public.intentos
  add column if not exists offline_recovery_until timestamptz,
  add column if not exists offline_recovery_completed_at timestamptz,
  add column if not exists offline_recovery_count integer not null default 0;

update public.intentos
set offline_recovery_until = deadline_at + interval '5 minutes'
where deadline_at is not null
  and offline_recovery_until is null;

do $$ begin
  alter table public.intentos
    add constraint intentos_offline_recovery_count_nonnegative
    check (offline_recovery_count >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.intentos
    add constraint intentos_offline_recovery_after_deadline
    check (
      offline_recovery_until is null
      or deadline_at is null
      or offline_recovery_until >= deadline_at
    );
exception when duplicate_object then null; end $$;

-- Only one open attempt may exist for the same student and exam.
-- The existing (exam_id, student_id, attempt_number) constraint still preserves history.
create unique index if not exists uq_intento_abierto_por_examen_estudiante
  on public.intentos(exam_id, student_id)
  where status in ('created'::public.attempt_status, 'in_progress'::public.attempt_status);

-- Service-only wrapper used after a controlled post-timeout offline recovery.
-- Automatic grading may have already run when the attempt became time_expired;
-- rerunning it is deterministic and updates the final score from the recovered answers.
create or replace function public.regrade_attempt_after_offline_recovery(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  return private.auto_grade_attempt(p_attempt_id);
end;
$$;

revoke all on function public.regrade_attempt_after_offline_recovery(uuid) from public, anon, authenticated;
grant execute on function public.regrade_attempt_after_offline_recovery(uuid) to service_role;

create index if not exists idx_intentos_offline_recovery_window
  on public.intentos(status, offline_recovery_until)
  where offline_recovery_until is not null;
-- <<< END MIGRATION: 0020_failure_recovery.sql

-- >>> BEGIN MIGRATION: 0021_strict_audit_fixes.sql
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
-- <<< END MIGRATION: 0021_strict_audit_fixes.sql

-- >>> BEGIN MIGRATION: 0022_safety_demo_exam.sql
-- 0022_safety_demo_exam.sql
-- Prompt 16: idempotent demo course, question bank and integrated Industrial Safety exam.

create or replace function private.demo_insert_question(
  p_bank_id uuid,
  p_owner_user_id uuid,
  p_type public.question_type,
  p_prompt text,
  p_unit text,
  p_topic text,
  p_subtopic text,
  p_difficulty public.question_difficulty,
  p_points numeric,
  p_answer_key jsonb default '{}'::jsonb,
  p_numeric_tolerance numeric default null,
  p_explanation text default null,
  p_grading_config jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_options jsonb default '[]'::jsonb,
  p_parent_question_id uuid default null,
  p_case_position integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_option jsonb;
  v_position integer := 0;
begin
  insert into public.preguntas(
    id, bank_id, type, prompt, unit, topic, subtopic, difficulty, points,
    answer_key, numeric_tolerance, explanation, grading_config, metadata,
    is_active, created_by_user_id, parent_question_id, case_position
  ) values (
    v_id, p_bank_id, p_type, p_prompt, p_unit, p_topic, p_subtopic, p_difficulty, p_points,
    coalesce(p_answer_key, '{}'::jsonb), p_numeric_tolerance, p_explanation,
    coalesce(p_grading_config, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('demo', true, 'demoVersion', 1),
    true, p_owner_user_id, p_parent_question_id, p_case_position
  );

  for v_option in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) value loop
    insert into public.alternativas(question_id, option_key, content, is_correct, position)
    values (
      v_id,
      coalesce(nullif(v_option->>'key', ''), chr(65 + v_position)),
      v_option->>'content',
      coalesce((v_option->>'correct')::boolean, false),
      v_position
    );
    v_position := v_position + 1;
  end loop;

  return v_id;
end;
$$;

revoke all on function private.demo_insert_question(uuid, uuid, public.question_type, text, text, text, text, public.question_difficulty, numeric, jsonb, numeric, text, jsonb, jsonb, jsonb, uuid, integer) from public, anon, authenticated;

create or replace function public.create_safety_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_teacher_id uuid;
  v_course_id uuid;
  v_bank_id uuid;
  v_exam_id uuid;
  v_q uuid;
  v_case uuid;
  v_code text;
  v_marker text := '[DEMO_DATA_PROMPT16]';
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'ACTIVE_TEACHER_REQUIRED';
  end if;

  select e.id, e.course_id
    into v_exam_id, v_course_id
  from public.examenes e
  where e.owner_user_id = v_user_id
    and e.is_deleted = false
    and e.description like '%' || v_marker || '%'
  order by e.created_at desc
  limit 1;

  if v_exam_id is not null then
    v_code := 'SEG' || upper(substr(replace(v_user_id::text, '-', ''), 1, 8)) || upper(substr(replace(v_exam_id::text, '-', ''), 1, 4));

    update public.configuraciones_examen
    set duration_minutes = 45,
        max_attempts = 3,
        target_question_count = 15,
        randomize_questions = true,
        randomize_options = true,
        navigation = 'free'::public.navigation_mode,
        allow_backtrack = true,
        auto_submit_on_timeout = true,
        result_visibility = 'full_feedback'::public.result_visibility,
        show_results_after = now(),
        require_student_code = true,
        require_first_name = true,
        require_last_name = true,
        require_email = false,
        require_section = false,
        restrict_to_enrolled_students = false,
        grade_scale_max = 20,
        passing_grade = 10.5,
        settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('demo', true, 'demoVersion', 1)
    where exam_id = v_exam_id;

    update public.examenes
    set access_code_lookup = encode(extensions.digest(v_code, 'sha256'), 'hex'),
        access_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 10)),
        access_code_hint = 'Código DEMO generado automáticamente',
        starts_at = now() - interval '5 minutes',
        ends_at = now() + interval '30 days',
        status = 'active'::public.exam_status,
        updated_at = now()
    where id = v_exam_id;

    return jsonb_build_object(
      'created', false,
      'examId', v_exam_id,
      'courseId', v_course_id,
      'accessCode', v_code,
      'questionCount', 15,
      'message', 'El examen DEMO ya existía; se reactivó su ventana de prueba.'
    );
  end if;

  insert into public.cursos(
    docente_id, code, name, description, academic_period, section, is_active
  ) values (
    v_teacher_id,
    'DEMO-SEG-IND',
    '[DEMO] Ingeniería de Seguridad',
    v_marker || ' Curso generado para probar integralmente EvaluaLab. Puede archivarse o eliminarse después de las pruebas.',
    'DEMO 2026',
    'DEMO',
    true
  ) returning id into v_course_id;

  insert into public.bancos_preguntas(
    course_id, owner_user_id, name, description, is_archived
  ) values (
    v_course_id,
    v_user_id,
    '[DEMO] Banco integral de Seguridad',
    v_marker || ' Preguntas de prueba sobre peligros, riesgos, IPERC, ruido, iluminación, ergonomía y manipulación manual de cargas.',
    false
  ) returning id into v_bank_id;

  insert into public.examenes(
    course_id, owner_user_id, title, description, instructions,
    starts_at, ends_at, status, is_deleted
  ) values (
    v_course_id,
    v_user_id,
    '[DEMO] Examen integral — Ingeniería de Seguridad',
    v_marker || ' Examen de demostración. No usar sus resultados como evaluación académica real.',
    'Este examen DEMO sirve para comprobar preguntas automáticas, desarrollo, imágenes, cálculos, evidencias y casos. Tiempo: 45 minutos. Escala: 0–20.',
    now() - interval '5 minutes',
    now() + interval '30 days',
    'draft'::public.exam_status,
    false
  ) returning id into v_exam_id;

  v_code := 'SEG' || upper(substr(replace(v_user_id::text, '-', ''), 1, 8)) || upper(substr(replace(v_exam_id::text, '-', ''), 1, 4));

  insert into public.configuraciones_examen(
    exam_id, duration_minutes, max_attempts, target_question_count,
    randomize_questions, randomize_options, navigation, allow_backtrack,
    auto_submit_on_timeout, result_visibility, show_results_after,
    require_student_code, require_first_name, require_last_name, require_email,
    require_section, restrict_to_enrolled_students, grade_scale_max,
    passing_grade, settings
  ) values (
    v_exam_id, 45, 3, 15,
    true, true, 'free'::public.navigation_mode, true,
    true, 'full_feedback'::public.result_visibility, now(),
    true, true, true, false,
    false, false, 20, 10.5,
    jsonb_build_object('demo', true, 'demoVersion', 1)
  );

  update public.examenes
  set access_code_lookup = encode(extensions.digest(v_code, 'sha256'), 'hex'),
      access_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 10)),
      access_code_hint = 'Código DEMO generado automáticamente'
  where id = v_exam_id;

  -- Q01: alternativa única
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'single_choice',
    '¿Cuál de las siguientes expresiones describe correctamente un peligro?',
    'Unidad 1', 'Peligros y riesgos', 'Conceptos básicos', 'basic', 1,
    jsonb_build_object('optionKey','B'), null,
    'Un peligro es una fuente, situación o acto con potencial de causar daño.', '{}',
    jsonb_build_object('demoKey','Q01'),
    '[{"key":"A","content":"La probabilidad de que ocurra un daño","correct":false},{"key":"B","content":"Una fuente, situación o acto con potencial de causar daño","correct":true},{"key":"C","content":"La consecuencia económica de un accidente","correct":false},{"key":"D","content":"El registro estadístico de incidentes","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,1); v_count := v_count + 1;

  -- Q02: verdadero/falso
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'true_false',
    'En una matriz IPERC, identificar el peligro debe realizarse antes de valorar el nivel de riesgo.',
    'Unidad 1', 'IPERC', 'Secuencia de evaluación', 'basic', 1,
    jsonb_build_object('value', true), null,
    'Primero se identifica el peligro; luego se estima y valora el riesgo.', '{}',
    jsonb_build_object('demoKey','Q02'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,2); v_count := v_count + 1;

  -- Q03: jerarquía de controles
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'single_choice',
    'Según la jerarquía de controles, ¿qué medida debe priorizarse cuando técnicamente es posible eliminar por completo la fuente de peligro?',
    'Unidad 1', 'Controles', 'Jerarquía de controles', 'intermediate', 1,
    jsonb_build_object('optionKey','A'), null,
    'La eliminación se ubica en el nivel más alto de la jerarquía de controles.', '{}',
    jsonb_build_object('demoKey','Q03'),
    '[{"key":"A","content":"Eliminación","correct":true},{"key":"B","content":"Equipo de protección personal","correct":false},{"key":"C","content":"Señalización","correct":false},{"key":"D","content":"Capacitación únicamente","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,3); v_count := v_count + 1;

  -- Q04: numérica con tolerancia
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'numeric',
    'En cinco puntos de un ambiente se midieron 300, 320, 280, 310 y 290 lux. Calcule la iluminancia promedio en lux.',
    'Unidad 2', 'Iluminación', 'Promedio de mediciones', 'intermediate', 1.5,
    jsonb_build_object('value',300), 0.5,
    'La media es (300+320+280+310+290)/5 = 300 lux.',
    jsonb_build_object('numericMode','tolerance'), jsonb_build_object('demoKey','Q04'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,4); v_count := v_count + 1;

  -- Q05: numérica exacta
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'numeric',
    'Una matriz de riesgo utiliza R = Probabilidad × Severidad. Si P = 3 y S = 4, ¿cuál es el valor de R?',
    'Unidad 1', 'IPERC', 'Valoración del riesgo', 'basic', 1,
    jsonb_build_object('value',12), null,
    'R = 3 × 4 = 12.', jsonb_build_object('numericMode','exact'), jsonb_build_object('demoKey','Q05'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,5); v_count := v_count + 1;

  -- Q06: imagen + alternativa
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'image_single_choice',
    'Observe la escena. ¿Cuál es la deficiencia más evidente respecto al equipo contra incendios?',
    'Unidad 3', 'Inspecciones de seguridad', 'Condiciones subestándar', 'intermediate', 1.5,
    jsonb_build_object('optionKey','C'), null,
    'El extintor está parcialmente bloqueado por cajas, reduciendo su accesibilidad.', '{}',
    jsonb_build_object('demoKey','Q06','demoMediaUrl','/demo/seguridad-almacen.svg'),
    '[{"key":"A","content":"El extintor tiene un color inadecuado","correct":false},{"key":"B","content":"No existe señalización de tránsito vehicular","correct":false},{"key":"C","content":"El acceso al extintor está obstruido por cajas","correct":true},{"key":"D","content":"La estantería debería ser de otro material","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,6); v_count := v_count + 1;

  -- Q07: desarrollo
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'essay',
    'Explique la diferencia entre peligro y riesgo utilizando un ejemplo de un taller de mantenimiento.',
    'Unidad 1', 'Peligros y riesgos', 'Aplicación conceptual', 'intermediate', 1.5,
    '{}'::jsonb, null,
    'Criterio sugerido: identificar claramente la fuente de daño y diferenciarla de la combinación probabilidad-consecuencia.',
    jsonb_build_object('manualReview',true), jsonb_build_object('demoKey','Q07'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,7); v_count := v_count + 1;

  -- Q08: cálculo
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'calculation',
    'Para una exposición simplificada se usa D = (C/T) × 100. Si un trabajador estuvo C = 3 horas y el tiempo permitido T = 6 horas, calcule D (%).',
    'Unidad 2', 'Ruido', 'Cálculo de dosis simplificada', 'intermediate', 1.5,
    jsonb_build_object('value',50), 0.5,
    'D = (3/6) × 100 = 50 %.', jsonb_build_object('numericMode','tolerance'), jsonb_build_object('demoKey','Q08'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,8); v_count := v_count + 1;

  -- Q09: cálculo + evidencia
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'calculation_evidence',
    'Use D = (C/T) × 100. Si C = 2 horas y T = 4 horas, calcule la dosis (%) y adjunte una fotografía o PDF de su procedimiento.',
    'Unidad 2', 'Ruido', 'Cálculo con evidencia', 'intermediate', 2,
    jsonb_build_object('value',50), 0.5,
    'D = (2/4) × 100 = 50 %. La evidencia permite revisar el procedimiento.',
    jsonb_build_object('numericMode','tolerance','requireEvidence',true), jsonb_build_object('demoKey','Q09'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,9); v_count := v_count + 1;

  -- Q10: selección múltiple
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'multiple_choice',
    'Seleccione las DOS situaciones que representan principalmente factores de riesgo ergonómico.',
    'Unidad 4', 'Ergonomía', 'Factores de riesgo', 'intermediate', 1.5,
    jsonb_build_object('optionKeys',jsonb_build_array('A','C')), null,
    'Las posturas forzadas y la manipulación manual repetitiva de cargas son factores ergonómicos.', '{}',
    jsonb_build_object('demoKey','Q10'),
    '[{"key":"A","content":"Posturas forzadas mantenidas","correct":true},{"key":"B","content":"Contacto con un conductor energizado","correct":false},{"key":"C","content":"Levantamiento repetitivo de cargas","correct":true},{"key":"D","content":"Exposición a vapores corrosivos","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,10); v_count := v_count + 1;

  -- Q11: respuesta corta
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'short_text',
    'Escriba únicamente la sigla del proceso de Identificación de Peligros, Evaluación de Riesgos y Controles.',
    'Unidad 1', 'IPERC', 'Terminología', 'basic', 1,
    jsonb_build_object('answers',jsonb_build_array('IPERC','IPER-C')), null,
    'La sigla esperada es IPERC.',
    jsonb_build_object('mode','case_insensitive','trimWhitespace',true,'collapseWhitespace',true), jsonb_build_object('demoKey','Q11'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,11); v_count := v_count + 1;

  -- Q12: verdadero/falso iluminación
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'true_false',
    'El lux (lx) es una unidad utilizada para expresar iluminancia.',
    'Unidad 2', 'Iluminación', 'Unidades', 'basic', 1,
    jsonb_build_object('value',true), null,
    'El lux es la unidad del SI para iluminancia.', '{}', jsonb_build_object('demoKey','Q12'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,12); v_count := v_count + 1;

  -- Q13: imagen + desarrollo
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'image_essay',
    'Observe la escena de almacén e identifique dos condiciones inseguras distintas. Para cada una, indique una medida de control concreta.',
    'Unidad 3', 'Inspecciones de seguridad', 'Análisis visual', 'advanced', 1.5,
    '{}'::jsonb, null,
    'Ejemplos visibles: extintor obstruido, cable atravesando zona de paso y almacenamiento/apilamiento que requiere revisión.',
    jsonb_build_object('manualReview',true),
    jsonb_build_object('demoKey','Q13','demoMediaUrl','/demo/seguridad-almacen.svg'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,13); v_count := v_count + 1;

  -- Q14: archivo adjunto
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'attachment',
    'Adjunte una hoja, fotografía o PDF con un mini-IPERC de una actividad de manipulación manual de cargas. Debe contener como mínimo peligro, riesgo y un control propuesto.',
    'Unidad 4', 'Manipulación manual de cargas', 'Evidencia aplicada', 'advanced', 1,
    '{}'::jsonb, null,
    'Revisión manual del archivo adjunto.', jsonb_build_object('manualReview',true,'requireAttachment',true), jsonb_build_object('demoKey','Q14'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,14); v_count := v_count + 1;

  -- Q15: caso con dos subpreguntas
  v_case := private.demo_insert_question(v_bank_id, v_user_id, 'case_group',
    'CASO DEMO: En un área de despacho, un trabajador desplaza manualmente cajas de 20 kg durante el turno. El pasillo tiene materiales en el piso y el supervisor observa posturas de flexión frecuente del tronco. Responda las subpreguntas.',
    'Unidad 4', 'Ergonomía', 'Caso integrado', 'advanced', 2,
    '{}'::jsonb, null,
    'Caso para integrar identificación del peligro y valoración básica.', jsonb_build_object('manualReview',true), jsonb_build_object('demoKey','Q15'));

  perform private.demo_insert_question(v_bank_id, v_user_id, 'single_choice',
    '¿Cuál es el peligro ergonómico más directamente descrito en el caso?',
    'Unidad 4', 'Ergonomía', 'Caso integrado', 'intermediate', 1,
    jsonb_build_object('optionKey','B'), null,
    'La manipulación manual de cargas y la flexión frecuente del tronco constituyen el peligro ergonómico principal.', '{}',
    jsonb_build_object('demoKey','Q15A'),
    '[{"key":"A","content":"Radiación ionizante","correct":false},{"key":"B","content":"Manipulación manual de cargas y posturas forzadas","correct":true},{"key":"C","content":"Exposición biológica","correct":false},{"key":"D","content":"Ruido impulsivo","correct":false}]'::jsonb,
    v_case, 1);

  perform private.demo_insert_question(v_bank_id, v_user_id, 'numeric',
    'Si para un ejercicio didáctico se asigna Probabilidad = 3 y Severidad = 3, y se usa R = P × S, ¿qué valor obtiene?',
    'Unidad 4', 'IPERC', 'Caso integrado', 'intermediate', 1,
    jsonb_build_object('value',9), null,
    'R = 3 × 3 = 9.', jsonb_build_object('numericMode','exact'),
    jsonb_build_object('demoKey','Q15B'), '[]'::jsonb,
    v_case, 2);

  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_case,15); v_count := v_count + 1;

  if v_count <> 15 then
    raise exception 'DEMO_QUESTION_COUNT_MISMATCH:%', v_count;
  end if;

  update public.examenes
  set status = 'active'::public.exam_status,
      updated_at = now()
  where id = v_exam_id;

  return jsonb_build_object(
    'created', true,
    'courseId', v_course_id,
    'bankId', v_bank_id,
    'examId', v_exam_id,
    'accessCode', v_code,
    'questionCount', v_count,
    'activeUntil', now() + interval '30 days',
    'message', 'Examen DEMO creado y activado.'
  );
end;
$$;

revoke all on function public.create_safety_demo() from public, anon;
grant execute on function public.create_safety_demo() to authenticated;

comment on function public.create_safety_demo() is
'Creates an idempotent Industrial Safety demo course, bank and 15-question exam for the authenticated active teacher.';
-- <<< END MIGRATION: 0022_safety_demo_exam.sql

-- >>> BEGIN MIGRATION: 0023_global_settings.sql
-- 0023_global_settings.sql
-- Prompt 20: persistent global institutional and academic configuration.

create table if not exists public.configuracion_global (
  id smallint primary key default 1,
  institution_name text not null default 'Institución educativa',
  platform_name text not null default 'EvaluaLab',
  platform_subtitle text not null default 'Ingeniería Industrial',
  logo_bucket text,
  logo_path text,
  grade_scale_max numeric(8,3) not null default 20,
  passing_grade numeric(8,3) not null default 10.5,
  timezone text not null default 'America/Lima',
  date_format text not null default 'DD/MM/YYYY',
  evidence_allowed_mime_types text[] not null default array['image/jpeg','image/png','image/webp','application/pdf']::text[],
  evidence_max_bytes bigint not null default 15728640,
  updated_by_user_id uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint configuracion_global_singleton check (id = 1),
  constraint configuracion_global_institution_not_blank check (btrim(institution_name) <> '' and char_length(institution_name) <= 180),
  constraint configuracion_global_platform_not_blank check (btrim(platform_name) <> '' and char_length(platform_name) <= 100),
  constraint configuracion_global_subtitle_length check (char_length(platform_subtitle) <= 160),
  constraint configuracion_global_scale_positive check (grade_scale_max > 0 and grade_scale_max <= 1000),
  constraint configuracion_global_passing_in_scale check (passing_grade >= 0 and passing_grade <= grade_scale_max),
  constraint configuracion_global_timezone_not_blank check (btrim(timezone) <> '' and char_length(timezone) <= 120),
  constraint configuracion_global_date_format check (date_format in ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD')),
  constraint configuracion_global_evidence_types_nonempty check (cardinality(evidence_allowed_mime_types) between 1 and 4),
  constraint configuracion_global_evidence_types_supported check (
    evidence_allowed_mime_types <@ array['image/jpeg','image/png','image/webp','application/pdf']::text[]
  ),
  constraint configuracion_global_evidence_size check (evidence_max_bytes between 1048576 and 52428800),
  constraint configuracion_global_logo_pair check (
    (logo_bucket is null and logo_path is null)
    or (logo_bucket = 'branding' and logo_path is not null and logo_path like 'global/%')
  )
);

insert into public.configuracion_global (id)
values (1)
on conflict (id) do nothing;

alter table public.configuracion_global enable row level security;

revoke all on public.configuracion_global from public, anon, authenticated;
grant select (
  id, institution_name, platform_name, platform_subtitle,
  logo_bucket, logo_path, grade_scale_max, passing_grade,
  timezone, date_format, evidence_allowed_mime_types,
  evidence_max_bytes, updated_at
) on public.configuracion_global to anon, authenticated;
grant update (
  institution_name, platform_name, platform_subtitle,
  logo_bucket, logo_path, grade_scale_max, passing_grade,
  timezone, date_format, evidence_allowed_mime_types,
  evidence_max_bytes
) on public.configuracion_global to authenticated;

-- Public pages need the non-sensitive branding/defaults. The table contains no secrets.
drop policy if exists global_settings_public_select on public.configuracion_global;
create policy global_settings_public_select
on public.configuracion_global for select
to anon, authenticated
using (id = 1);

-- This installation is designed as a teacher-owned academic platform. Active
-- teacher/admin accounts may update the singleton; inactive accounts are rejected
-- by private.current_app_role().
drop policy if exists global_settings_teacher_update on public.configuracion_global;
create policy global_settings_teacher_update
on public.configuracion_global for update
to authenticated
using (
  id = 1
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
)
with check (
  id = 1
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

create or replace function private.stamp_global_settings_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := 1;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone) then
    raise exception 'Invalid IANA timezone: %', new.timezone;
  end if;
  if auth.uid() is not null then
    new.updated_by_user_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_configuracion_global_actor on public.configuracion_global;
create trigger trg_configuracion_global_actor
before update on public.configuracion_global
for each row execute function private.stamp_global_settings_actor();

-- Keep the private student-evidence bucket aligned with the global rules. The
-- application still re-validates type, size, extension and magic bytes server-side.
create or replace function private.sync_global_evidence_bucket_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update storage.buckets
  set file_size_limit = new.evidence_max_bytes,
      allowed_mime_types = new.evidence_allowed_mime_types
  where id = 'student-evidence';
  return new;
end;
$$;

drop trigger if exists trg_configuracion_global_storage_sync on public.configuracion_global;
create trigger trg_configuracion_global_storage_sync
after update of evidence_max_bytes, evidence_allowed_mime_types on public.configuracion_global
for each row execute function private.sync_global_evidence_bucket_config();

-- Branding is intentionally public: a logo is not sensitive. Write access remains
-- limited to active teacher/admin sessions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists branding_public_select on storage.objects;
create policy branding_public_select
on storage.objects for select
to public
using (bucket_id = 'branding');

drop policy if exists branding_teacher_insert on storage.objects;
create policy branding_teacher_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

drop policy if exists branding_teacher_update on storage.objects;
create policy branding_teacher_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
)
with check (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

drop policy if exists branding_teacher_delete on storage.objects;
create policy branding_teacher_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

-- Ensure an existing installation immediately reflects the persisted defaults.
update storage.buckets b
set file_size_limit = c.evidence_max_bytes,
    allowed_mime_types = c.evidence_allowed_mime_types
from public.configuracion_global c
where b.id = 'student-evidence' and c.id = 1;
-- <<< END MIGRATION: 0023_global_settings.sql

-- >>> BEGIN MIGRATION: 0024_final_integrity_accessibility.sql
-- 0024_final_integrity_accessibility.sql
-- Prompt 21 final audit: transactional exam writes and identity consistency.

-- The public access flow always requires a stable student identifier. Align the
-- persisted exam configuration with that rule so the teacher cannot save an
-- impossible combination (both student code and email disabled).
update public.configuraciones_examen
set require_student_code = true
where require_student_code = false
  and require_email = false;

do $$ begin
  alter table public.configuraciones_examen
    add constraint config_student_identifier_required
    check (require_student_code or require_email);
exception when duplicate_object then null; end $$;

-- Create exam + configuration + optional access code as one PostgreSQL
-- transaction. SECURITY INVOKER intentionally preserves RLS and caller rights.
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_course_id := nullif(btrim(coalesce(p_exam->>'courseId', '')), '')::uuid;
  v_title := btrim(coalesce(p_exam->>'title', ''));
  if v_course_id is null then raise exception 'Course is required'; end if;
  if v_title = '' then raise exception 'Exam title is required'; end if;

  insert into public.examenes (
    course_id, owner_user_id, title, description, instructions,
    starts_at, ends_at, status, is_deleted
  ) values (
    v_course_id,
    auth.uid(),
    v_title,
    nullif(btrim(coalesce(p_exam->>'description', '')), ''),
    nullif(btrim(coalesce(p_exam->>'instructions', '')), ''),
    nullif(p_exam->>'startsAt', '')::timestamptz,
    nullif(p_exam->>'endsAt', '')::timestamptz,
    'draft'::public.exam_status,
    false
  ) returning id into v_exam_id;

  insert into public.configuraciones_examen (
    exam_id,
    duration_minutes,
    max_attempts,
    target_question_count,
    randomize_questions,
    randomize_options,
    navigation,
    allow_backtrack,
    auto_submit_on_timeout,
    result_visibility,
    show_results_after,
    require_student_code,
    require_first_name,
    require_last_name,
    require_email,
    require_section,
    restrict_to_enrolled_students,
    grade_scale_max,
    passing_grade
  ) values (
    v_exam_id,
    coalesce((p_config->>'duration_minutes')::integer, 60),
    coalesce((p_config->>'max_attempts')::integer, 1),
    coalesce((p_config->>'target_question_count')::integer, 20),
    coalesce((p_config->>'randomize_questions')::boolean, true),
    coalesce((p_config->>'randomize_options')::boolean, true),
    coalesce(nullif(p_config->>'navigation', ''), 'free')::public.navigation_mode,
    coalesce((p_config->>'allow_backtrack')::boolean, true),
    true,
    coalesce(nullif(p_config->>'result_visibility', ''), 'confirmation_only')::public.result_visibility,
    nullif(p_config->>'show_results_after', '')::timestamptz,
    coalesce((p_config->>'require_student_code')::boolean, true),
    coalesce((p_config->>'require_first_name')::boolean, true),
    coalesce((p_config->>'require_last_name')::boolean, true),
    coalesce((p_config->>'require_email')::boolean, false),
    coalesce((p_config->>'require_section')::boolean, false),
    coalesce((p_config->>'restrict_to_enrolled_students')::boolean, false),
    coalesce((p_config->>'grade_scale_max')::numeric, 20),
    coalesce((p_config->>'passing_grade')::numeric, 10.5)
  );

  v_code := btrim(coalesce(p_access_code, ''));
  if v_code <> '' then
    perform public.set_exam_access_code(v_exam_id, v_code);
  end if;

  return v_exam_id;
end;
$$;

-- Update exam + configuration + access code as one PostgreSQL transaction.
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.examenes
  set course_id = nullif(btrim(coalesce(p_exam->>'courseId', '')), '')::uuid,
      title = btrim(coalesce(p_exam->>'title', '')),
      description = nullif(btrim(coalesce(p_exam->>'description', '')), ''),
      instructions = nullif(btrim(coalesce(p_exam->>'instructions', '')), ''),
      starts_at = nullif(p_exam->>'startsAt', '')::timestamptz,
      ends_at = nullif(p_exam->>'endsAt', '')::timestamptz,
      updated_at = now()
  where id = p_exam_id
    and is_deleted = false;

  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'Exam not found or not accessible';
  end if;

  insert into public.configuraciones_examen (
    exam_id,
    duration_minutes,
    max_attempts,
    target_question_count,
    randomize_questions,
    randomize_options,
    navigation,
    allow_backtrack,
    auto_submit_on_timeout,
    result_visibility,
    show_results_after,
    require_student_code,
    require_first_name,
    require_last_name,
    require_email,
    require_section,
    restrict_to_enrolled_students,
    grade_scale_max,
    passing_grade
  ) values (
    p_exam_id,
    coalesce((p_config->>'duration_minutes')::integer, 60),
    coalesce((p_config->>'max_attempts')::integer, 1),
    coalesce((p_config->>'target_question_count')::integer, 20),
    coalesce((p_config->>'randomize_questions')::boolean, true),
    coalesce((p_config->>'randomize_options')::boolean, true),
    coalesce(nullif(p_config->>'navigation', ''), 'free')::public.navigation_mode,
    coalesce((p_config->>'allow_backtrack')::boolean, true),
    true,
    coalesce(nullif(p_config->>'result_visibility', ''), 'confirmation_only')::public.result_visibility,
    nullif(p_config->>'show_results_after', '')::timestamptz,
    coalesce((p_config->>'require_student_code')::boolean, true),
    coalesce((p_config->>'require_first_name')::boolean, true),
    coalesce((p_config->>'require_last_name')::boolean, true),
    coalesce((p_config->>'require_email')::boolean, false),
    coalesce((p_config->>'require_section')::boolean, false),
    coalesce((p_config->>'restrict_to_enrolled_students')::boolean, false),
    coalesce((p_config->>'grade_scale_max')::numeric, 20),
    coalesce((p_config->>'passing_grade')::numeric, 10.5)
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
    require_student_code = excluded.require_student_code,
    require_first_name = excluded.require_first_name,
    require_last_name = excluded.require_last_name,
    require_email = excluded.require_email,
    require_section = excluded.require_section,
    restrict_to_enrolled_students = excluded.restrict_to_enrolled_students,
    grade_scale_max = excluded.grade_scale_max,
    passing_grade = excluded.passing_grade,
    updated_at = now();

  if coalesce(p_clear_access_code, false) then
    perform public.clear_exam_access_code(p_exam_id);
  else
    v_code := btrim(coalesce(p_access_code, ''));
    if v_code <> '' then
      perform public.set_exam_access_code(p_exam_id, v_code);
    end if;
  end if;
end;
$$;

revoke all on function public.create_exam_bundle(jsonb, jsonb, text) from public, anon;
revoke all on function public.update_exam_bundle(uuid, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function public.create_exam_bundle(jsonb, jsonb, text) to authenticated;
grant execute on function public.update_exam_bundle(uuid, jsonb, jsonb, text, boolean) to authenticated;

-- Prevent a course change after an exam has acquired question-plan or attempt
-- history. Otherwise fixed questions/rules from the previous course could remain
-- attached to an exam that now claims to belong to another course.
create or replace function public.prevent_exam_course_change_with_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.course_id is distinct from old.course_id and (
    exists (select 1 from public.preguntas_examen pe where pe.exam_id = old.id)
    or exists (select 1 from public.reglas_seleccion_examen rs where rs.exam_id = old.id)
    or exists (select 1 from public.intentos i where i.exam_id = old.id)
  ) then
    raise exception 'No se puede cambiar de curso un examen que ya tiene preguntas, reglas de selección o intentos.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_exam_course_change_with_history on public.examenes;
create trigger trg_prevent_exam_course_change_with_history
before update of course_id on public.examenes
for each row execute function public.prevent_exam_course_change_with_history();
-- <<< END MIGRATION: 0024_final_integrity_accessibility.sql

-- >>> BEGIN MIGRATION: 0025_desafio_industrial_security_reports.sql
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
-- <<< END MIGRATION: 0025_desafio_industrial_security_reports.sql

-- >>> BEGIN MIGRATION: 0026_live_exam_monitoring.sql
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
-- <<< END MIGRATION: 0026_live_exam_monitoring.sql

-- >>> BEGIN MIGRATION: 0027_teacher_audit_hardening.sql
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
-- <<< END MIGRATION: 0027_teacher_audit_hardening.sql

-- >>> BEGIN MIGRATION: 0028_importer_rls_runtime_hotfix.sql
-- 0028_importer_rls_runtime_hotfix.sql
-- Hotfix validado durante E2E real de importacion completa v1.3.0.
-- Corrige RLS de cursos y examenes para INSERT ... RETURNING sin desactivar RLS.

drop policy if exists cursos_teacher_insert_direct
on public.cursos;

drop policy if exists cursos_teacher_all
on public.cursos;

create policy cursos_teacher_all
on public.cursos
for all
to authenticated
using (
  docente_id = private.current_teacher_id()
  or private.is_admin()
)
with check (
  docente_id = private.current_teacher_id()
  or private.is_admin()
);

drop policy if exists examenes_teacher_all
on public.examenes;

create policy examenes_teacher_all
on public.examenes
for all
to authenticated
using (
  owner_user_id = auth.uid()
  or private.owns_course(course_id)
  or private.is_admin()
)
with check (
  private.owns_course(course_id)
  and (
    owner_user_id = auth.uid()
    or private.is_admin()
  )
);
-- <<< END MIGRATION: 0028_importer_rls_runtime_hotfix.sql

-- >>> BEGIN MIGRATION: 0029_live_time_extension_security_fix.sql
-- 0029_live_time_extension_security_fix.sql
-- Corrige extensiones de tiempo docente en produccion.
-- Las RPC necesitan actualizar student_attempt_sessions, tabla reservada al backend.

alter function public.teacher_extend_attempt_time(uuid, integer) security definer;
alter function public.teacher_extend_attempt_time(uuid, integer) set search_path to pg_catalog, public, private, pg_temp;

alter function public.teacher_extend_exam_time(uuid, integer) security definer;
alter function public.teacher_extend_exam_time(uuid, integer) set search_path to pg_catalog, public, private, pg_temp;

revoke all on function public.teacher_extend_attempt_time(uuid, integer) from public, anon;
revoke all on function public.teacher_extend_exam_time(uuid, integer) from public, anon;

grant execute on function public.teacher_extend_attempt_time(uuid, integer) to authenticated;
grant execute on function public.teacher_extend_exam_time(uuid, integer) to authenticated;
-- <<< END MIGRATION: 0029_live_time_extension_security_fix.sql

-- >>> BEGIN MIGRATION: 0030_teacher_force_close_deadline_fix.sql
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
-- <<< END MIGRATION: 0030_teacher_force_close_deadline_fix.sql

-- >>> BEGIN MIGRATION: 0031_grade_cap_and_evidence_pdf.sql
-- 0031_grade_cap_and_evidence_pdf.sql
-- Configurable final-grade cap (stored in configuraciones_examen.settings.grading.finalGradeCap)
-- and hard server-side enforcement for every grade write.

create or replace function private.validate_exam_grade_cap_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_raw text;
  v_cap numeric;
begin
  v_raw := nullif(btrim(coalesce(new.settings #>> '{grading,finalGradeCap}', '')), '');
  if v_raw is null then
    return new;
  end if;

  begin
    v_cap := v_raw::numeric;
  exception when others then
    raise exception 'La nota maxima permitida debe ser numerica.';
  end;

  if v_cap <= 0 then
    raise exception 'La nota maxima permitida debe ser mayor que cero.';
  end if;

  if v_cap > new.grade_scale_max then
    raise exception 'La nota maxima permitida no puede superar la escala de calificacion.';
  end if;

  if v_cap < new.passing_grade then
    raise exception 'La nota maxima permitida no puede ser menor que la nota aprobatoria.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_configuraciones_examen_validate_grade_cap on public.configuraciones_examen;
create trigger trg_configuraciones_examen_validate_grade_cap
before insert or update of settings, grade_scale_max, passing_grade
on public.configuraciones_examen
for each row
execute function private.validate_exam_grade_cap_settings();

create or replace function private.apply_attempt_final_grade_cap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_frozen jsonb;
  v_settings jsonb;
  v_scale numeric;
  v_cap numeric;
  v_raw text;
begin
  if new.final_grade is null then
    return new;
  end if;

  select i.frozen_exam_config, c.settings, c.grade_scale_max
  into v_frozen, v_settings, v_scale
  from public.intentos i
  join public.configuraciones_examen c on c.exam_id = i.exam_id
  where i.id = new.attempt_id;

  if not found then
    return new;
  end if;

  v_raw := nullif(btrim(coalesce(v_frozen->>'finalGradeCap', '')), '');
  if v_raw is null then
    v_raw := nullif(btrim(coalesce(v_settings #>> '{grading,finalGradeCap}', '')), '');
  end if;

  begin
    v_cap := coalesce(v_raw::numeric, v_scale);
  exception when others then
    v_cap := v_scale;
  end;

  v_cap := greatest(0, least(v_cap, v_scale));
  new.final_grade := least(new.final_grade, v_cap);
  return new;
end;
$$;

drop trigger if exists trg_calificaciones_apply_final_grade_cap on public.calificaciones;
create trigger trg_calificaciones_apply_final_grade_cap
before insert or update of final_grade, attempt_id
on public.calificaciones
for each row
execute function private.apply_attempt_final_grade_cap();

revoke all on function private.validate_exam_grade_cap_settings() from public, anon, authenticated;
revoke all on function private.apply_attempt_final_grade_cap() from public, anon, authenticated;
-- <<< END MIGRATION: 0031_grade_cap_and_evidence_pdf.sql

-- >>> BEGIN MIGRATION: 0032_direct_question_points_scoring.sql
-- 0032_direct_question_points_scoring.sql
-- El puntaje de cada pregunta constituye directamente la nota final.
-- La suma del plan debe coincidir exactamente con la nota maxima configurada
-- (20 por defecto; un valor menor, como 15, puede usarse de forma excepcional).

create or replace function private.exam_scoring_plan_summary(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_exam public.examenes%rowtype;
  v_rule public.reglas_seleccion_examen%rowtype;
  v_fixed_total numeric := 0;
  v_random_total numeric := 0;
  v_candidate_count integer := 0;
  v_min_points numeric;
  v_max_points numeric;
  v_per_question numeric;
  v_deterministic boolean := true;
  v_issue text := null;
begin
  select * into v_exam
  from public.examenes
  where id = p_exam_id and is_deleted = false;

  if not found then
    raise exception 'EXAM_NOT_FOUND';
  end if;

  select coalesce(sum(coalesce(pe.points_override, q.points)), 0)
  into v_fixed_total
  from public.preguntas_examen pe
  join public.preguntas q on q.id = pe.question_id
  join public.bancos_preguntas b on b.id = q.bank_id
  where pe.exam_id = p_exam_id
    and b.course_id = v_exam.course_id
    and b.is_archived = false
    and q.is_active = true
    and q.parent_question_id is null;

  for v_rule in
    select *
    from public.reglas_seleccion_examen
    where exam_id = p_exam_id
    order by rule_order, id
  loop
    if v_rule.points_override is not null then
      v_per_question := v_rule.points_override;
    else
      select count(*), min(q.points), max(q.points)
      into v_candidate_count, v_min_points, v_max_points
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
        and not exists (
          select 1
          from public.preguntas_examen pe
          where pe.exam_id = p_exam_id and pe.question_id = q.id
        );

      if v_candidate_count < v_rule.quantity then
        v_deterministic := false;
        v_issue := coalesce(v_issue, 'Una regla aleatoria no tiene suficientes preguntas candidatas.');
        continue;
      end if;

      if v_min_points is null or v_max_points is null or abs(v_max_points - v_min_points) > 0.001 then
        v_deterministic := false;
        v_issue := coalesce(v_issue, 'Una regla aleatoria contiene preguntas con puntajes distintos y no tiene puntaje por pregunta definido.');
        continue;
      end if;

      v_per_question := v_min_points;
    end if;

    v_random_total := v_random_total + (v_rule.quantity * v_per_question);
  end loop;

  return jsonb_build_object(
    'deterministic', v_deterministic,
    'fixedPoints', round(v_fixed_total, 3),
    'randomPoints', case when v_deterministic then round(v_random_total, 3) else null end,
    'totalPoints', case when v_deterministic then round(v_fixed_total + v_random_total, 3) else null end,
    'issue', v_issue
  );
end;
$$;

create or replace function public.get_exam_scoring_plan_summary(p_exam_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
  select private.exam_scoring_plan_summary(p_exam_id);
$$;

revoke all on function public.get_exam_scoring_plan_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_exam_scoring_plan_summary(uuid) to service_role;

create or replace function private.validate_exam_scoring_before_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_cfg public.configuraciones_examen%rowtype;
  v_summary jsonb;
  v_cap numeric;
  v_total numeric;
begin
  if new.status::text not in ('scheduled', 'active') then
    return new;
  end if;

  select * into v_cfg
  from public.configuraciones_examen
  where exam_id = new.id;

  if not found then
    raise exception 'No existe configuracion para validar el puntaje del examen.';
  end if;

  begin
    v_cap := coalesce(nullif(v_cfg.settings #>> '{grading,finalGradeCap}', '')::numeric, v_cfg.grade_scale_max);
  exception when others then
    v_cap := v_cfg.grade_scale_max;
  end;

  v_summary := private.exam_scoring_plan_summary(new.id);
  if not coalesce((v_summary->>'deterministic')::boolean, false) then
    raise exception '%', coalesce(v_summary->>'issue', 'El puntaje del examen no es determinista.');
  end if;

  v_total := coalesce((v_summary->>'totalPoints')::numeric, 0);
  if abs(v_total - v_cap) > 0.001 then
    raise exception 'La suma de puntajes del examen (%) debe coincidir exactamente con la nota maxima configurada (%).', v_total, v_cap;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_examenes_validate_scoring_before_publish on public.examenes;
create trigger trg_examenes_validate_scoring_before_publish
before insert or update of status
on public.examenes
for each row
execute function private.validate_exam_scoring_before_publish();

-- Conserva las validaciones de 0031 y, si el examen ya esta publicado,
-- impide cambiar la nota maxima a un valor que deje de coincidir con el plan.
create or replace function private.validate_exam_grade_cap_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_raw text;
  v_cap numeric;
  v_status text;
  v_summary jsonb;
  v_total numeric;
begin
  v_raw := nullif(btrim(coalesce(new.settings #>> '{grading,finalGradeCap}', '')), '');
  if v_raw is null then
    v_cap := new.grade_scale_max;
  else
    begin
      v_cap := v_raw::numeric;
    exception when others then
      raise exception 'La nota maxima del examen debe ser numerica.';
    end;
  end if;

  if v_cap <= 0 then
    raise exception 'La nota maxima del examen debe ser mayor que cero.';
  end if;

  if v_cap > new.grade_scale_max then
    raise exception 'La nota maxima del examen no puede superar la escala institucional.';
  end if;

  if v_cap < new.passing_grade then
    raise exception 'La nota maxima del examen no puede ser menor que la nota aprobatoria.';
  end if;

  select status::text into v_status
  from public.examenes
  where id = new.exam_id;

  if v_status in ('scheduled', 'active') then
    v_summary := private.exam_scoring_plan_summary(new.exam_id);
    if not coalesce((v_summary->>'deterministic')::boolean, false) then
      raise exception '%', coalesce(v_summary->>'issue', 'El puntaje del examen no es determinista.');
    end if;
    v_total := coalesce((v_summary->>'totalPoints')::numeric, 0);
    if abs(v_total - v_cap) > 0.001 then
      raise exception 'La suma de puntajes del examen (%) debe coincidir exactamente con la nota maxima configurada (%).', v_total, v_cap;
    end if;
  end if;

  return new;
end;
$$;

-- La fila de calificaciones queda protegida por la misma regla. Para intentos
-- nuevos, max_raw_score coincide con la nota maxima y final_grade = raw_score.
-- Los intentos historicos con otra escala conservan el comportamiento previo.
create or replace function private.apply_attempt_final_grade_cap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_frozen jsonb;
  v_settings jsonb;
  v_scale numeric;
  v_cap numeric;
  v_raw text;
begin
  select i.frozen_exam_config, c.settings, c.grade_scale_max
  into v_frozen, v_settings, v_scale
  from public.intentos i
  join public.configuraciones_examen c on c.exam_id = i.exam_id
  where i.id = new.attempt_id;

  if not found then
    return new;
  end if;

  v_raw := nullif(btrim(coalesce(v_frozen->>'finalGradeCap', '')), '');
  if v_raw is null then
    v_raw := nullif(btrim(coalesce(v_settings #>> '{grading,finalGradeCap}', '')), '');
  end if;

  begin
    v_cap := coalesce(v_raw::numeric, v_scale);
  exception when others then
    v_cap := v_scale;
  end;

  v_cap := greatest(0, least(v_cap, v_scale));

  if coalesce(new.pending_manual_reviews, 0) > 0 then
    new.final_grade := null;
    return new;
  end if;

  if new.raw_score is not null
     and new.max_raw_score is not null
     and abs(new.max_raw_score - v_cap) <= 0.001 then
    new.final_grade := round(least(greatest(new.raw_score, 0), v_cap), 3);
  elsif new.final_grade is not null then
    new.final_grade := least(new.final_grade, v_cap);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_calificaciones_apply_final_grade_cap on public.calificaciones;
create trigger trg_calificaciones_apply_final_grade_cap
before insert or update of final_grade, attempt_id, raw_score, max_raw_score, pending_manual_reviews
on public.calificaciones
for each row
execute function private.apply_attempt_final_grade_cap();

revoke all on function private.exam_scoring_plan_summary(uuid) from public, anon, authenticated;
revoke all on function private.validate_exam_scoring_before_publish() from public, anon, authenticated;
revoke all on function private.validate_exam_grade_cap_settings() from public, anon, authenticated;
revoke all on function private.apply_attempt_final_grade_cap() from public, anon, authenticated;
-- <<< END MIGRATION: 0032_direct_question_points_scoring.sql

-- >>> BEGIN MIGRATION: 0033_manual_grade_finalization_consistency.sql
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
-- <<< END MIGRATION: 0033_manual_grade_finalization_consistency.sql

-- >>> BEGIN MIGRATION: 0034_student_result_access_codes.sql
-- 0034_student_result_access_codes.sql
-- Adds a per-attempt, high-entropy result access credential. Only a SHA-256
-- digest is persisted; the plain code is returned to the student when issued
-- and must be presented again to reopen corrected results.

alter table public.intentos
  add column if not exists result_access_code_hash text,
  add column if not exists result_access_code_issued_at timestamptz,
  add column if not exists result_access_code_last_used_at timestamptz;

create unique index if not exists intentos_result_access_code_hash_unique
  on public.intentos(result_access_code_hash)
  where result_access_code_hash is not null;

do $$ begin
  alter table public.intentos
    add constraint intentos_result_access_code_hash_format
    check (result_access_code_hash is null or result_access_code_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;

comment on column public.intentos.result_access_code_hash is
  'SHA-256 digest of the per-attempt personal code used only to reopen corrected student results.';
comment on column public.intentos.result_access_code_issued_at is
  'Timestamp when the personal result code was first issued.';
comment on column public.intentos.result_access_code_last_used_at is
  'Timestamp of the most recent successful result-code verification.';
-- <<< END MIGRATION: 0034_student_result_access_codes.sql

-- >>> BEGIN MIGRATION: 0035_ai_grading_assist.sql
-- 0035_ai_grading_assist.sql
-- v1.4.0: auditable AI-assisted grading. AI suggestions never alter grades directly.

create table if not exists public.ai_grading_suggestions (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.respuestas(id) on delete cascade,
  attempt_id uuid not null references public.intentos(id) on delete cascade,
  attempt_question_id uuid not null references public.intento_preguntas(id) on delete cascade,
  requested_by_user_id uuid not null references public.usuarios(id) on delete restrict,
  provider text not null default 'openai',
  model text not null,
  prompt_version text not null,
  suggested_score numeric(8,3) not null,
  confidence numeric(5,4),
  rubric_scores jsonb not null default '[]'::jsonb,
  feedback text,
  rationale text,
  decision text not null default 'proposed',
  decided_by_user_id uuid references public.usuarios(id) on delete set null,
  decided_at timestamptz,
  provider_request_id text,
  request_fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_grading_score_nonnegative check (suggested_score >= 0),
  constraint ai_grading_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint ai_grading_decision_valid check (decision in ('proposed', 'applied', 'rejected')),
  constraint ai_grading_provider_not_blank check (btrim(provider) <> ''),
  constraint ai_grading_model_not_blank check (btrim(model) <> ''),
  constraint ai_grading_prompt_version_not_blank check (btrim(prompt_version) <> '')
);

create index if not exists idx_ai_grading_response_created
  on public.ai_grading_suggestions(response_id, created_at desc);

create index if not exists idx_ai_grading_attempt_created
  on public.ai_grading_suggestions(attempt_id, created_at desc);

create index if not exists idx_ai_grading_decision
  on public.ai_grading_suggestions(decision, created_at desc);

create index if not exists idx_ai_grading_fingerprint
  on public.ai_grading_suggestions(response_id, request_fingerprint, created_at desc)
  where decision = 'proposed';

drop trigger if exists trg_ai_grading_suggestions_updated_at on public.ai_grading_suggestions;
create trigger trg_ai_grading_suggestions_updated_at
before update on public.ai_grading_suggestions
for each row execute function public.set_updated_at();

alter table public.ai_grading_suggestions enable row level security;

drop policy if exists ai_grading_suggestions_teacher_select on public.ai_grading_suggestions;
create policy ai_grading_suggestions_teacher_select
on public.ai_grading_suggestions for select to authenticated
using (private.owns_attempt(attempt_id));

-- The audit table is readable by authorized teachers, but browser clients cannot
-- forge or mutate AI suggestions. INSERT/UPDATE are performed only by the
-- authenticated Edge Function using the server credential after RLS-based
-- ownership checks have succeeded.
revoke insert, update, delete on public.ai_grading_suggestions from authenticated;
grant select on public.ai_grading_suggestions to authenticated;

comment on table public.ai_grading_suggestions is
  'Auditable AI grading suggestions. Advisory only; writes are server-side and never replace the teacher grading RPC.';
-- <<< END MIGRATION: 0035_ai_grading_assist.sql
