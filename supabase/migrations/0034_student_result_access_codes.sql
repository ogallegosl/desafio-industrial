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
