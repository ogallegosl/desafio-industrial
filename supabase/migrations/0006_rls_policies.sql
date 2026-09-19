-- 0006_rls_policies.sql
-- RLS defaults to deny. No anonymous/student direct access is granted yet.

alter table public.usuarios enable row level security;
alter table public.docentes enable row level security;
alter table public.estudiantes enable row level security;
alter table public.cursos enable row level security;
alter table public.matriculas enable row level security;
alter table public.bancos_preguntas enable row level security;
alter table public.preguntas enable row level security;
alter table public.alternativas enable row level security;
alter table public.examenes enable row level security;
alter table public.configuraciones_examen enable row level security;
alter table public.preguntas_examen enable row level security;
alter table public.reglas_seleccion_examen enable row level security;
alter table public.intentos enable row level security;
alter table public.intento_preguntas enable row level security;
alter table public.respuestas enable row level security;
alter table public.evidencias enable row level security;
alter table public.calificaciones enable row level security;
alter table public.logs enable row level security;

-- Usuarios
drop policy if exists usuarios_select_self_or_admin on public.usuarios;
create policy usuarios_select_self_or_admin
on public.usuarios for select to authenticated
using (id = auth.uid() or private.is_admin());

drop policy if exists usuarios_update_self_or_admin on public.usuarios;
create policy usuarios_update_self_or_admin
on public.usuarios for update to authenticated
using (id = auth.uid() or private.is_admin())
with check (id = auth.uid() or private.is_admin());

-- Docentes
drop policy if exists docentes_select_self_or_admin on public.docentes;
create policy docentes_select_self_or_admin
on public.docentes for select to authenticated
using (usuario_id = auth.uid() or private.is_admin());

drop policy if exists docentes_admin_all on public.docentes;
create policy docentes_admin_all
on public.docentes for all to authenticated
using (private.is_admin())
with check (private.is_admin());

-- Estudiantes
drop policy if exists estudiantes_teacher_select on public.estudiantes;
create policy estudiantes_teacher_select
on public.estudiantes for select to authenticated
using (
  created_by_user_id = auth.uid()
  or private.is_admin()
  or exists (
    select 1
    from public.matriculas m
    join public.cursos c on c.id = m.course_id
    join public.docentes d on d.id = c.docente_id
    where m.student_id = estudiantes.id
      and d.usuario_id = auth.uid()
  )
);

drop policy if exists estudiantes_teacher_insert on public.estudiantes;
create policy estudiantes_teacher_insert
on public.estudiantes for insert to authenticated
with check (
  private.current_app_role() in ('teacher','admin')
  and (created_by_user_id = auth.uid() or private.is_admin())
);

drop policy if exists estudiantes_teacher_update on public.estudiantes;
create policy estudiantes_teacher_update
on public.estudiantes for update to authenticated
using (
  created_by_user_id = auth.uid()
  or private.is_admin()
  or exists (
    select 1
    from public.matriculas m
    join public.cursos c on c.id = m.course_id
    join public.docentes d on d.id = c.docente_id
    where m.student_id = estudiantes.id
      and d.usuario_id = auth.uid()
  )
)
with check (
  created_by_user_id = auth.uid()
  or private.is_admin()
  or exists (
    select 1
    from public.matriculas m
    join public.cursos c on c.id = m.course_id
    join public.docentes d on d.id = c.docente_id
    where m.student_id = estudiantes.id
      and d.usuario_id = auth.uid()
  )
);

-- Cursos
drop policy if exists cursos_teacher_all on public.cursos;
create policy cursos_teacher_all
on public.cursos for all to authenticated
using (private.owns_course(id))
with check (
  docente_id = private.current_teacher_id()
  or private.is_admin()
);

-- Matriculas
drop policy if exists matriculas_teacher_all on public.matriculas;
create policy matriculas_teacher_all
on public.matriculas for all to authenticated
using (private.owns_course(course_id))
with check (private.owns_course(course_id));

-- Bancos
drop policy if exists bancos_teacher_all on public.bancos_preguntas;
create policy bancos_teacher_all
on public.bancos_preguntas for all to authenticated
using (private.owns_course(course_id))
with check (
  private.owns_course(course_id)
  and (owner_user_id = auth.uid() or private.is_admin())
);

-- Preguntas: intentionally no student access
drop policy if exists preguntas_teacher_all on public.preguntas;
create policy preguntas_teacher_all
on public.preguntas for all to authenticated
using (
  exists (
    select 1 from public.bancos_preguntas b
    where b.id = preguntas.bank_id
      and private.owns_course(b.course_id)
  )
)
with check (
  created_by_user_id = auth.uid()
  and exists (
    select 1 from public.bancos_preguntas b
    where b.id = preguntas.bank_id
      and private.owns_course(b.course_id)
  )
  or private.is_admin()
);

drop policy if exists alternativas_teacher_all on public.alternativas;
create policy alternativas_teacher_all
on public.alternativas for all to authenticated
using (
  exists (
    select 1
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    where q.id = alternativas.question_id
      and private.owns_course(b.course_id)
  )
)
with check (
  exists (
    select 1
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    where q.id = alternativas.question_id
      and private.owns_course(b.course_id)
  )
);

-- Exámenes
drop policy if exists examenes_teacher_all on public.examenes;
create policy examenes_teacher_all
on public.examenes for all to authenticated
using (private.owns_exam(id))
with check (
  private.owns_course(course_id)
  and (owner_user_id = auth.uid() or private.is_admin())
);

drop policy if exists configuraciones_teacher_all on public.configuraciones_examen;
create policy configuraciones_teacher_all
on public.configuraciones_examen for all to authenticated
using (private.owns_exam(exam_id))
with check (private.owns_exam(exam_id));

drop policy if exists preguntas_examen_teacher_all on public.preguntas_examen;
create policy preguntas_examen_teacher_all
on public.preguntas_examen for all to authenticated
using (private.owns_exam(exam_id))
with check (
  private.owns_exam(exam_id)
  and exists (
    select 1
    from public.preguntas q
    join public.bancos_preguntas b on b.id = q.bank_id
    join public.examenes e on e.id = preguntas_examen.exam_id
    where q.id = preguntas_examen.question_id
      and b.course_id = e.course_id
  )
);

drop policy if exists selection_rules_teacher_all on public.reglas_seleccion_examen;
create policy selection_rules_teacher_all
on public.reglas_seleccion_examen for all to authenticated
using (private.owns_exam(exam_id))
with check (
  private.owns_exam(exam_id)
  and (
    bank_id is null
    or exists (
      select 1
      from public.bancos_preguntas b
      join public.examenes e on e.id = reglas_seleccion_examen.exam_id
      where b.id = reglas_seleccion_examen.bank_id
        and b.course_id = e.course_id
    )
  )
);

-- Intentos and all response data: teacher only for now.
-- Student access will be mediated in Prompt 03/08 instead of exposing tables.
drop policy if exists intentos_teacher_all on public.intentos;
create policy intentos_teacher_all
on public.intentos for all to authenticated
using (private.owns_exam(exam_id))
with check (private.owns_exam(exam_id));

drop policy if exists intento_preguntas_teacher_all on public.intento_preguntas;
create policy intento_preguntas_teacher_all
on public.intento_preguntas for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists respuestas_teacher_all on public.respuestas;
create policy respuestas_teacher_all
on public.respuestas for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists evidencias_teacher_all on public.evidencias;
create policy evidencias_teacher_all
on public.evidencias for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists calificaciones_teacher_all on public.calificaciones;
create policy calificaciones_teacher_all
on public.calificaciones for all to authenticated
using (private.owns_attempt(attempt_id))
with check (private.owns_attempt(attempt_id));

drop policy if exists logs_teacher_select on public.logs;
create policy logs_teacher_select
on public.logs for select to authenticated
using (
  private.is_admin()
  or (exam_id is not null and private.owns_exam(exam_id))
  or (attempt_id is not null and private.owns_attempt(attempt_id))
);

drop policy if exists logs_teacher_insert on public.logs;
create policy logs_teacher_insert
on public.logs for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and (
    private.is_admin()
    or exam_id is null
    or private.owns_exam(exam_id)
  )
);

-- Explicit table grants. RLS remains authoritative.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.usuarios,
  public.docentes,
  public.estudiantes,
  public.cursos,
  public.matriculas,
  public.bancos_preguntas,
  public.preguntas,
  public.alternativas,
  public.examenes,
  public.configuraciones_examen,
  public.preguntas_examen,
  public.reglas_seleccion_examen,
  public.intentos,
  public.intento_preguntas,
  public.respuestas,
  public.evidencias,
  public.calificaciones,
  public.logs
to authenticated;

grant usage, select on sequence public.logs_id_seq to authenticated;

-- No grants to anon on protected data tables.
revoke all on
  public.usuarios,
  public.docentes,
  public.estudiantes,
  public.cursos,
  public.matriculas,
  public.bancos_preguntas,
  public.preguntas,
  public.alternativas,
  public.examenes,
  public.configuraciones_examen,
  public.preguntas_examen,
  public.reglas_seleccion_examen,
  public.intentos,
  public.intento_preguntas,
  public.respuestas,
  public.evidencias,
  public.calificaciones,
  public.logs
from anon;


-- The view inherits caller permissions from underlying tables via security_invoker.
revoke all on public.resultados from anon;
revoke all on public.resultados from authenticated;
grant select on public.resultados to authenticated;
