-- 0007_storage.sql
-- Private buckets and teacher policies. Student uploads are intentionally not opened
-- to anonymous users; Prompt 09 will use a controlled upload mechanism.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'question-media',
    'question-media',
    false,
    10485760,
    array['image/jpeg','image/png','image/webp']
  ),
  (
    'student-evidence',
    'student-evidence',
    false,
    15728640,
    array['image/jpeg','image/png','image/webp','application/pdf']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Recommended object path:
-- question-media/<teacher-user-uuid>/<question-uuid>/<filename>
-- student-evidence/<teacher-user-uuid>/<exam-uuid>/<attempt-uuid>/<filename>

drop policy if exists question_media_teacher_select on storage.objects;
create policy question_media_teacher_select
on storage.objects for select to authenticated
using (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists question_media_teacher_insert on storage.objects;
create policy question_media_teacher_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists question_media_teacher_update on storage.objects;
create policy question_media_teacher_update
on storage.objects for update to authenticated
using (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
)
with check (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists question_media_teacher_delete on storage.objects;
create policy question_media_teacher_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'question-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_select on storage.objects;
create policy evidence_teacher_select
on storage.objects for select to authenticated
using (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_insert on storage.objects;
create policy evidence_teacher_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_update on storage.objects;
create policy evidence_teacher_update
on storage.objects for update to authenticated
using (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
)
with check (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);

drop policy if exists evidence_teacher_delete on storage.objects;
create policy evidence_teacher_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'student-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_admin()
  )
);
