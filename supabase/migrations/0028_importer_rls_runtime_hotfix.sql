-- 0028_importer_rls_runtime_hotfix.sql
-- Hotfix validado durante E2E real de importacion completa v1.3.0.
-- Corrige RLS de cursos y examenes para INSERT ... RETURNING sin desactivar RLS.

drop policy if exists cursos_teacher_insert_direct
on public.cursos;

drop policy if exists cursos_teacher_all
on public.cursos;

create policy cursos_teacher_all
on public.cursos
for all
to authenticated
using (
  docente_id = private.current_teacher_id()
  or private.is_admin()
)
with check (
  docente_id = private.current_teacher_id()
  or private.is_admin()
);

drop policy if exists examenes_teacher_all
on public.examenes;

create policy examenes_teacher_all
on public.examenes
for all
to authenticated
using (
  owner_user_id = auth.uid()
  or private.owns_course(course_id)
  or private.is_admin()
)
with check (
  private.owns_course(course_id)
  and (
    owner_user_id = auth.uid()
    or private.is_admin()
  )
);