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
