-- 0029_live_time_extension_security_fix.sql
-- Corrige extensiones de tiempo docente en produccion.
-- Las RPC necesitan actualizar student_attempt_sessions, tabla reservada al backend.

alter function public.teacher_extend_attempt_time(uuid, integer) security definer;
alter function public.teacher_extend_attempt_time(uuid, integer) set search_path to pg_catalog, public, private, pg_temp;

alter function public.teacher_extend_exam_time(uuid, integer) security definer;
alter function public.teacher_extend_exam_time(uuid, integer) set search_path to pg_catalog, public, private, pg_temp;

revoke all on function public.teacher_extend_attempt_time(uuid, integer) from public, anon;
revoke all on function public.teacher_extend_exam_time(uuid, integer) from public, anon;

grant execute on function public.teacher_extend_attempt_time(uuid, integer) to authenticated;
grant execute on function public.teacher_extend_exam_time(uuid, integer) to authenticated;
