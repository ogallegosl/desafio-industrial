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
