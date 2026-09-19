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
