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
