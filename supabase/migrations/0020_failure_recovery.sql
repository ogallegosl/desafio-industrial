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
