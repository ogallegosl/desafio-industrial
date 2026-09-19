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
