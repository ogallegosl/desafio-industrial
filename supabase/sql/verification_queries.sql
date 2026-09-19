-- verification_queries.sql
-- Run after migrations in Supabase SQL Editor.

-- 1. Expected public tables
select tablename
from pg_tables
where schemaname = 'public'
order by tablename;

-- 2. RLS status
select
  n.nspname as schema_name,
  c.relname as relation_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

-- 3. Policies
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname in ('public','storage')
order by schemaname, tablename, policyname;

-- 4. Private storage buckets
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('question-media','student-evidence')
order by id;

-- 5. Ensure no protected table privileges were granted to anon.
select
  table_schema,
  table_name,
  privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
  and table_name in (
    'usuarios','docentes','estudiantes','cursos','matriculas',
    'bancos_preguntas','preguntas','alternativas','examenes',
    'configuraciones_examen','preguntas_examen','reglas_seleccion_examen',
    'intentos','intento_preguntas','respuestas','evidencias',
    'calificaciones','logs'
  )
order by table_name, privilege_type;

-- Expected result for query 5: zero rows.

-- 6. Verify that the result view uses security_invoker.
select
  c.relname,
  c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'resultados';


-- 7. Prompt 10: verify automatic-grading trigger.
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'intentos'
  and trigger_name = 'trg_auto_grade_attempt';

-- 8. Prompt 10: verify grading columns.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'respuestas' and column_name in ('auto_grading_details','auto_graded_at','auto_grading_version'))
    or (table_name = 'calificaciones' and column_name in ('pending_manual_reviews','auto_graded_at','auto_grading_version')))
order by table_name, column_name;

-- 9. Strict audit: stable student identity must be globally unique by normalized code.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'estudiantes_student_code_ci_unique';

-- 10. Strict audit: atomic autosave RPC must exist and only service_role should execute it.
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'save_attempt_answer_if_newer';

-- Expected: anon_execute=false, authenticated_execute=false, service_execute=true.

-- 11. Strict audit: hard deadline cannot be disabled.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.configuraciones_examen'::regclass
  and conname = 'config_auto_submit_timeout_required';

-- 12. Strict audit: detect unsupported nested upload questions. Expected: zero rows.
select id, parent_question_id, type, prompt
from public.preguntas
where parent_question_id is not null
  and type in ('calculation_evidence'::public.question_type, 'attachment'::public.question_type);

-- 13. Strict audit: duplicate normalized student codes. Expected: zero rows.
select lower(student_code) as normalized_code, count(*)
from public.estudiantes
group by lower(student_code)
having count(*) > 1;
