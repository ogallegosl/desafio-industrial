-- 0018_results_export.sql
-- Prompt 13: secure detailed rows used by Excel/CSV exports.

create or replace function public.get_exam_export_details(p_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.owns_exam(p_exam_id) then raise exception 'FORBIDDEN'; end if;

  with rows as (
    select
      i.id as attempt_id,
      i.attempt_number,
      i.status,
      s.student_code,
      s.first_name,
      s.last_name,
      s.email,
      s.section,
      q.id as attempt_question_id,
      q.display_order,
      q.question_type,
      q.prompt_snapshot,
      q.points_snapshot,
      q.options_snapshot,
      q.grading_snapshot,
      q.metadata_snapshot,
      r.id as response_id,
      r.answer_text,
      r.answer_numeric,
      r.selected_option_ids,
      r.answer_payload,
      coalesce(r.is_answered, false) as is_answered,
      r.is_correct,
      r.auto_score,
      r.manual_score,
      r.review_status,
      r.teacher_feedback,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'filename', e.original_filename,
          'mimeType', e.mime_type,
          'sizeBytes', e.size_bytes
        ) order by e.uploaded_at)
        from public.evidencias e
        where e.response_id = r.id
          and e.deleted_at is null
      ), '[]'::jsonb) as evidence_files
    from public.intentos i
    join public.estudiantes s on s.id = i.student_id
    join public.intento_preguntas q on q.attempt_id = i.id
    left join public.respuestas r on r.attempt_question_id = q.id
    where i.exam_id = p_exam_id
      and i.status <> 'cancelled'::public.attempt_status
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'attemptId', attempt_id,
      'attemptNumber', attempt_number,
      'status', status::text,
      'studentCode', student_code,
      'firstName', first_name,
      'lastName', last_name,
      'email', email,
      'section', section,
      'questionOrder', display_order,
      'type', question_type::text,
      'prompt', prompt_snapshot,
      'points', points_snapshot,
      'options', options_snapshot,
      'grading', grading_snapshot,
      'metadata', metadata_snapshot,
      'answerText', answer_text,
      'answerNumeric', answer_numeric,
      'selectedOptionIds', selected_option_ids,
      'answerPayload', answer_payload,
      'isAnswered', is_answered,
      'isCorrect', is_correct,
      'autoScore', auto_score,
      'manualScore', manual_score,
      'effectiveScore', case
        when review_status = 'reviewed'::public.review_status then coalesce(manual_score, 0)
        else coalesce(auto_score, 0)
      end,
      'reviewStatus', coalesce(review_status::text, 'not_required'),
      'teacherFeedback', teacher_feedback,
      'evidenceFiles', evidence_files
    ) order by lower(last_name), lower(first_name), attempt_number, display_order
  ), '[]'::jsonb)
  into v_result
  from rows;

  return v_result;
end;
$$;

revoke all on function public.get_exam_export_details(uuid) from public;
grant execute on function public.get_exam_export_details(uuid) to authenticated;
