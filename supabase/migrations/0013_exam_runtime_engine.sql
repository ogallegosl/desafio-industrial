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
