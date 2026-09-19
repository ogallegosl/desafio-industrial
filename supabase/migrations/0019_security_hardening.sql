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
