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
