-- 0023_global_settings.sql
-- Prompt 20: persistent global institutional and academic configuration.

create table if not exists public.configuracion_global (
  id smallint primary key default 1,
  institution_name text not null default 'Institución educativa',
  platform_name text not null default 'EvaluaLab',
  platform_subtitle text not null default 'Ingeniería Industrial',
  logo_bucket text,
  logo_path text,
  grade_scale_max numeric(8,3) not null default 20,
  passing_grade numeric(8,3) not null default 10.5,
  timezone text not null default 'America/Lima',
  date_format text not null default 'DD/MM/YYYY',
  evidence_allowed_mime_types text[] not null default array['image/jpeg','image/png','image/webp','application/pdf']::text[],
  evidence_max_bytes bigint not null default 15728640,
  updated_by_user_id uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint configuracion_global_singleton check (id = 1),
  constraint configuracion_global_institution_not_blank check (btrim(institution_name) <> '' and char_length(institution_name) <= 180),
  constraint configuracion_global_platform_not_blank check (btrim(platform_name) <> '' and char_length(platform_name) <= 100),
  constraint configuracion_global_subtitle_length check (char_length(platform_subtitle) <= 160),
  constraint configuracion_global_scale_positive check (grade_scale_max > 0 and grade_scale_max <= 1000),
  constraint configuracion_global_passing_in_scale check (passing_grade >= 0 and passing_grade <= grade_scale_max),
  constraint configuracion_global_timezone_not_blank check (btrim(timezone) <> '' and char_length(timezone) <= 120),
  constraint configuracion_global_date_format check (date_format in ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD')),
  constraint configuracion_global_evidence_types_nonempty check (cardinality(evidence_allowed_mime_types) between 1 and 4),
  constraint configuracion_global_evidence_types_supported check (
    evidence_allowed_mime_types <@ array['image/jpeg','image/png','image/webp','application/pdf']::text[]
  ),
  constraint configuracion_global_evidence_size check (evidence_max_bytes between 1048576 and 52428800),
  constraint configuracion_global_logo_pair check (
    (logo_bucket is null and logo_path is null)
    or (logo_bucket = 'branding' and logo_path is not null and logo_path like 'global/%')
  )
);

insert into public.configuracion_global (id)
values (1)
on conflict (id) do nothing;

alter table public.configuracion_global enable row level security;

revoke all on public.configuracion_global from public, anon, authenticated;
grant select (
  id, institution_name, platform_name, platform_subtitle,
  logo_bucket, logo_path, grade_scale_max, passing_grade,
  timezone, date_format, evidence_allowed_mime_types,
  evidence_max_bytes, updated_at
) on public.configuracion_global to anon, authenticated;
grant update (
  institution_name, platform_name, platform_subtitle,
  logo_bucket, logo_path, grade_scale_max, passing_grade,
  timezone, date_format, evidence_allowed_mime_types,
  evidence_max_bytes
) on public.configuracion_global to authenticated;

-- Public pages need the non-sensitive branding/defaults. The table contains no secrets.
drop policy if exists global_settings_public_select on public.configuracion_global;
create policy global_settings_public_select
on public.configuracion_global for select
to anon, authenticated
using (id = 1);

-- This installation is designed as a teacher-owned academic platform. Active
-- teacher/admin accounts may update the singleton; inactive accounts are rejected
-- by private.current_app_role().
drop policy if exists global_settings_teacher_update on public.configuracion_global;
create policy global_settings_teacher_update
on public.configuracion_global for update
to authenticated
using (
  id = 1
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
)
with check (
  id = 1
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

create or replace function private.stamp_global_settings_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := 1;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone) then
    raise exception 'Invalid IANA timezone: %', new.timezone;
  end if;
  if auth.uid() is not null then
    new.updated_by_user_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_configuracion_global_actor on public.configuracion_global;
create trigger trg_configuracion_global_actor
before update on public.configuracion_global
for each row execute function private.stamp_global_settings_actor();

-- Keep the private student-evidence bucket aligned with the global rules. The
-- application still re-validates type, size, extension and magic bytes server-side.
create or replace function private.sync_global_evidence_bucket_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update storage.buckets
  set file_size_limit = new.evidence_max_bytes,
      allowed_mime_types = new.evidence_allowed_mime_types
  where id = 'student-evidence';
  return new;
end;
$$;

drop trigger if exists trg_configuracion_global_storage_sync on public.configuracion_global;
create trigger trg_configuracion_global_storage_sync
after update of evidence_max_bytes, evidence_allowed_mime_types on public.configuracion_global
for each row execute function private.sync_global_evidence_bucket_config();

-- Branding is intentionally public: a logo is not sensitive. Write access remains
-- limited to active teacher/admin sessions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists branding_public_select on storage.objects;
create policy branding_public_select
on storage.objects for select
to public
using (bucket_id = 'branding');

drop policy if exists branding_teacher_insert on storage.objects;
create policy branding_teacher_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

drop policy if exists branding_teacher_update on storage.objects;
create policy branding_teacher_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
)
with check (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

drop policy if exists branding_teacher_delete on storage.objects;
create policy branding_teacher_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = 'global'
  and private.current_app_role() in ('teacher'::public.app_role, 'admin'::public.app_role)
);

-- Ensure an existing installation immediately reflects the persisted defaults.
update storage.buckets b
set file_size_limit = c.evidence_max_bytes,
    allowed_mime_types = c.evidence_allowed_mime_types
from public.configuracion_global c
where b.id = 'student-evidence' and c.id = 1;
