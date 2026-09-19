-- 0015_auto_grading_engine.sql
-- Prompt 10: deterministic server-side automatic grading.

alter table public.respuestas
  add column if not exists auto_grading_details jsonb not null default '{}'::jsonb,
  add column if not exists auto_graded_at timestamptz,
  add column if not exists auto_grading_version integer;

alter table public.calificaciones
  add column if not exists pending_manual_reviews integer not null default 0,
  add column if not exists auto_graded_at timestamptz,
  add column if not exists auto_grading_version integer;

do $$ begin
  alter table public.respuestas
    add constraint respuestas_auto_grading_version_positive
    check (auto_grading_version is null or auto_grading_version > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.calificaciones
    add constraint calificaciones_pending_manual_nonnegative
    check (pending_manual_reviews >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.calificaciones
    add constraint calificaciones_auto_grading_version_positive
    check (auto_grading_version is null or auto_grading_version > 0);
exception when duplicate_object then null; end $$;

create or replace function private.jsonb_text_array_set_equal(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce((
    select array_agg(distinct value order by value)
    from jsonb_array_elements_text(coalesce(p_left, '[]'::jsonb)) value
  ), array[]::text[])
  = coalesce((
    select array_agg(distinct value order by value)
    from jsonb_array_elements_text(coalesce(p_right, '[]'::jsonb)) value
  ), array[]::text[]);
$$;

create or replace function private.normalize_grade_text(p_value text, p_config jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v text := coalesce(p_value, '');
  v_mode text := coalesce(p_config->>'mode', 'case_insensitive');
  v_trim boolean := coalesce((p_config->>'trimWhitespace')::boolean, true);
  v_collapse boolean := coalesce((p_config->>'collapseWhitespace')::boolean, false);
begin
  if v_trim then
    v := btrim(v);
  end if;
  if v_collapse then
    v := regexp_replace(v, '[[:space:]]+', ' ', 'g');
  end if;
  if v_mode = 'case_insensitive' then
    v := lower(v);
  end if;
  return v;
end;
$$;

create or replace function private.answer_json_present(p_type public.question_type, p_answer jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb := coalesce(p_answer->'answerPayload', '{}'::jsonb);
begin
  if p_type in ('single_choice'::public.question_type, 'image_single_choice'::public.question_type, 'multiple_choice'::public.question_type) then
    return jsonb_array_length(coalesce(p_answer->'selectedOptionIds', '[]'::jsonb)) > 0;
  elsif p_type = 'true_false'::public.question_type then
    return v_payload ? 'value' and jsonb_typeof(v_payload->'value') = 'boolean';
  elsif p_type in ('numeric'::public.question_type, 'calculation'::public.question_type) then
    return p_answer ? 'answerNumeric' and p_answer->'answerNumeric' <> 'null'::jsonb;
  elsif p_type = 'calculation_evidence'::public.question_type then
    return p_answer ? 'answerNumeric'
      and p_answer->'answerNumeric' <> 'null'::jsonb
      and coalesce((v_payload->>'evidenceCount')::integer, 0) > 0;
  elsif p_type in ('short_text'::public.question_type, 'essay'::public.question_type, 'image_essay'::public.question_type) then
    return btrim(coalesce(p_answer->>'answerText', '')) <> '';
  elsif p_type = 'attachment'::public.question_type then
    return coalesce((v_payload->>'evidenceCount')::integer, 0) > 0;
  end if;
  return false;
end;
$$;

create or replace function private.grade_auto_item(
  p_type public.question_type,
  p_points numeric,
  p_grading jsonb,
  p_answer_text text,
  p_answer_numeric numeric,
  p_selected_option_ids jsonb,
  p_answer_payload jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  v_points numeric := greatest(coalesce(p_points, 0), 0);
  v_answer_key jsonb := coalesce(p_grading->'answerKey', '{}'::jsonb);
  v_config jsonb := coalesce(p_grading->'gradingConfig', '{}'::jsonb);
  v_correct boolean := false;
  v_score numeric := 0;
  v_target numeric;
  v_tolerance numeric;
  v_min numeric;
  v_max numeric;
  v_numeric_mode text;
  v_candidate text;
  v_accepted text;
  v_manual boolean := false;
begin
  if p_type in ('essay'::public.question_type, 'image_essay'::public.question_type, 'attachment'::public.question_type) then
    return jsonb_build_object('isCorrect', null, 'autoScore', 0, 'needsManual', true, 'method', 'manual');
  end if;

  if p_type in ('single_choice'::public.question_type, 'image_single_choice'::public.question_type, 'multiple_choice'::public.question_type) then
    v_correct := private.jsonb_text_array_set_equal(
      coalesce(p_selected_option_ids, '[]'::jsonb),
      coalesce(p_grading->'correctOptionIds', '[]'::jsonb)
    );
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object('isCorrect', v_correct, 'autoScore', v_score, 'needsManual', false, 'method', 'options_exact_set');
  end if;

  if p_type = 'true_false'::public.question_type then
    v_correct := (coalesce(p_answer_payload, '{}'::jsonb)->'value') = (v_answer_key->'value')
      and (coalesce(p_answer_payload, '{}'::jsonb) ? 'value');
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object('isCorrect', v_correct, 'autoScore', v_score, 'needsManual', false, 'method', 'boolean');
  end if;

  if p_type = 'short_text'::public.question_type then
    v_candidate := private.normalize_grade_text(p_answer_text, v_config);
    v_correct := false;
    for v_accepted in select value from jsonb_array_elements_text(coalesce(v_answer_key->'answers', '[]'::jsonb)) value loop
      if v_candidate = private.normalize_grade_text(v_accepted, v_config) then
        v_correct := true;
        exit;
      end if;
    end loop;
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object('isCorrect', v_correct, 'autoScore', v_score, 'needsManual', false, 'method', coalesce(v_config->>'mode', 'case_insensitive'));
  end if;

  if p_type in ('numeric'::public.question_type, 'calculation'::public.question_type, 'calculation_evidence'::public.question_type) then
    v_numeric_mode := coalesce(v_config->>'numericMode',
      case
        when v_answer_key ? 'min' or v_answer_key ? 'max' then 'range'
        when p_grading->>'numericTolerance' is not null then 'tolerance'
        else 'exact'
      end
    );

    if p_answer_numeric is null then
      v_correct := false;
    elsif v_numeric_mode = 'range' then
      v_min := nullif(coalesce(v_config->>'min', v_answer_key->>'min'), '')::numeric;
      v_max := nullif(coalesce(v_config->>'max', v_answer_key->>'max'), '')::numeric;
      v_correct := v_min is not null and v_max is not null and p_answer_numeric between v_min and v_max;
    else
      v_target := nullif(v_answer_key->>'value', '')::numeric;
      if v_numeric_mode = 'tolerance' then
        v_tolerance := greatest(coalesce(nullif(p_grading->>'numericTolerance', '')::numeric, 0), 0);
        v_correct := v_target is not null and abs(p_answer_numeric - v_target) <= v_tolerance;
      else
        v_correct := v_target is not null and p_answer_numeric = v_target;
      end if;
    end if;

    v_manual := p_type = 'calculation_evidence'::public.question_type;
    if v_manual and coalesce((coalesce(p_answer_payload, '{}'::jsonb)->>'evidenceCount')::integer, 0) <= 0 then
      v_correct := false;
    end if;
    v_score := case when v_correct then v_points else 0 end;
    return jsonb_build_object(
      'isCorrect', v_correct,
      'autoScore', v_score,
      'needsManual', v_manual,
      'method', v_numeric_mode
    );
  end if;

  return jsonb_build_object('isCorrect', null, 'autoScore', 0, 'needsManual', true, 'method', 'manual_fallback');
end;
$$;

create or replace function private.auto_grade_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_attempt public.intentos%rowtype;
  v_config public.configuraciones_examen%rowtype;
  v_question record;
  v_response public.respuestas%rowtype;
  v_grade jsonb;
  v_details jsonb;
  v_review public.review_status;
  v_auto numeric;
  v_is_correct boolean;
  v_child_display jsonb;
  v_child_grade jsonb;
  v_child_answer jsonb;
  v_child_result jsonb;
  v_case_auto numeric;
  v_case_manual_pending boolean;
  v_case_has_manual boolean;
  v_case_all_auto_correct boolean;
  v_case_has_auto boolean;
  v_case_details jsonb;
  v_total_auto numeric;
  v_total_manual numeric;
  v_total_max numeric;
  v_pending integer;
  v_raw numeric;
  v_scale numeric;
  v_final numeric;
  v_now timestamptz := now();
  v_version integer := 1;
begin
  select * into v_attempt from public.intentos where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status not in ('submitted'::public.attempt_status, 'time_expired'::public.attempt_status) then
    raise exception 'ATTEMPT_NOT_CLOSED';
  end if;

  select * into v_config from public.configuraciones_examen where exam_id = v_attempt.exam_id;
  if not found then raise exception 'EXAM_CONFIGURATION_NOT_FOUND'; end if;

  for v_question in
    select q.*
    from public.intento_preguntas q
    where q.attempt_id = p_attempt_id
    order by q.display_order
  loop
    select * into v_response
    from public.respuestas
    where attempt_question_id = v_question.id;

    if not found then
      insert into public.respuestas(
        attempt_question_id, attempt_id, selected_option_ids, answer_payload,
        is_answered, review_status, client_revision, last_saved_at
      ) values (
        v_question.id, p_attempt_id, '[]'::jsonb, '{}'::jsonb,
        false, 'not_required'::public.review_status, 0, v_now
      ) returning * into v_response;
    end if;

    if v_question.question_type = 'case_group'::public.question_type then
      v_case_auto := 0;
      v_case_manual_pending := false;
      v_case_has_manual := false;
      v_case_all_auto_correct := true;
      v_case_has_auto := false;
      v_case_details := '[]'::jsonb;

      for v_child_display in
        select value from jsonb_array_elements(coalesce(v_question.metadata_snapshot->'caseSubquestions', '[]'::jsonb))
      loop
        select value into v_child_grade
        from jsonb_array_elements(coalesce(v_question.grading_snapshot->'caseSubquestions', '[]'::jsonb)) value
        where value->>'id' = v_child_display->>'id'
        limit 1;

        v_child_answer := coalesce(v_response.answer_payload->'caseAnswers'->(v_child_display->>'id'), '{}'::jsonb);
        v_child_result := private.grade_auto_item(
          (v_child_display->>'type')::public.question_type,
          coalesce((v_child_display->>'points')::numeric, 0),
          coalesce(v_child_grade->'grading', '{}'::jsonb),
          v_child_answer->>'answerText',
          nullif(v_child_answer->>'answerNumeric', '')::numeric,
          coalesce(v_child_answer->'selectedOptionIds', '[]'::jsonb),
          coalesce(v_child_answer->'answerPayload', '{}'::jsonb)
        );

        v_case_auto := v_case_auto + coalesce((v_child_result->>'autoScore')::numeric, 0);
        if coalesce((v_child_result->>'needsManual')::boolean, false) then
          v_case_has_manual := true;
          if private.answer_json_present((v_child_display->>'type')::public.question_type, v_child_answer) then
            v_case_manual_pending := true;
          end if;
        end if;
        if not coalesce((v_child_result->>'needsManual')::boolean, false) then
          v_case_has_auto := true;
          if not coalesce((v_child_result->>'isCorrect')::boolean, false) then
            v_case_all_auto_correct := false;
          end if;
        end if;

        v_case_details := v_case_details || jsonb_build_array(jsonb_build_object(
          'childId', v_child_display->>'id',
          'type', v_child_display->>'type',
          'points', coalesce((v_child_display->>'points')::numeric, 0),
          'isAnswered', private.answer_json_present((v_child_display->>'type')::public.question_type, v_child_answer),
          'isCorrect', v_child_result->'isCorrect',
          'autoScore', v_child_result->'autoScore',
          'needsManual', v_child_result->'needsManual',
          'method', v_child_result->'method'
        ));
      end loop;

      v_auto := least(v_case_auto, v_question.points_snapshot);
      v_review := case when v_case_manual_pending then 'pending'::public.review_status else 'not_required'::public.review_status end;
      v_is_correct := case when v_case_has_manual or not v_case_has_auto then null else v_case_all_auto_correct end;
      v_details := jsonb_build_object('type', 'case_group', 'children', v_case_details, 'version', v_version);
    else
      v_grade := private.grade_auto_item(
        v_question.question_type,
        v_question.points_snapshot,
        v_question.grading_snapshot,
        v_response.answer_text,
        v_response.answer_numeric,
        v_response.selected_option_ids,
        v_response.answer_payload
      );
      v_auto := least(greatest(coalesce((v_grade->>'autoScore')::numeric, 0), 0), v_question.points_snapshot);
      v_is_correct := case when v_grade->'isCorrect' = 'null'::jsonb then null else (v_grade->>'isCorrect')::boolean end;
      v_review := case
        when coalesce((v_grade->>'needsManual')::boolean, false) and v_response.is_answered
          then 'pending'::public.review_status
        else 'not_required'::public.review_status
      end;
      v_details := jsonb_build_object(
        'type', v_question.question_type,
        'method', v_grade->>'method',
        'needsManual', coalesce((v_grade->>'needsManual')::boolean, false),
        'version', v_version
      );
    end if;

    update public.respuestas
    set
      is_correct = v_is_correct,
      auto_score = v_auto,
      review_status = v_review,
      auto_grading_details = v_details,
      auto_graded_at = v_now,
      auto_grading_version = v_version,
      updated_at = v_now
    where id = v_response.id;
  end loop;

  select
    coalesce(sum(coalesce(r.auto_score, 0)), 0),
    coalesce(sum(coalesce(r.manual_score, 0)), 0),
    coalesce(sum(q.points_snapshot), 0),
    count(*) filter (where r.review_status = 'pending'::public.review_status)
  into v_total_auto, v_total_manual, v_total_max, v_pending
  from public.intento_preguntas q
  left join public.respuestas r on r.attempt_question_id = q.id
  where q.attempt_id = p_attempt_id;

  v_raw := least(v_total_auto + v_total_manual, v_total_max);
  v_scale := coalesce(nullif(v_attempt.frozen_exam_config->>'gradeScaleMax', '')::numeric, v_config.grade_scale_max);
  v_final := case
    when v_pending = 0 and v_total_max > 0 then round((v_raw / v_total_max) * v_scale, 3)
    when v_pending = 0 and v_total_max = 0 then 0
    else null
  end;

  insert into public.calificaciones(
    attempt_id, auto_score, manual_score, raw_score, max_raw_score,
    final_grade, pending_manual_reviews, auto_graded_at, auto_grading_version,
    graded_at, updated_at
  ) values (
    p_attempt_id, v_total_auto, v_total_manual, v_raw, v_total_max,
    v_final, v_pending, v_now, v_version,
    case when v_pending = 0 then v_now else null end, v_now
  )
  on conflict (attempt_id) do update set
    auto_score = excluded.auto_score,
    manual_score = excluded.manual_score,
    raw_score = excluded.raw_score,
    max_raw_score = excluded.max_raw_score,
    final_grade = excluded.final_grade,
    pending_manual_reviews = excluded.pending_manual_reviews,
    auto_graded_at = excluded.auto_graded_at,
    auto_grading_version = excluded.auto_grading_version,
    graded_at = case when excluded.pending_manual_reviews = 0 then excluded.auto_graded_at else calificaciones.graded_at end,
    updated_at = excluded.updated_at;

  insert into public.logs(student_id, exam_id, attempt_id, event_type, metadata)
  values (
    v_attempt.student_id,
    v_attempt.exam_id,
    p_attempt_id,
    'AUTO_GRADING_COMPLETED',
    jsonb_build_object(
      'version', v_version,
      'autoScore', v_total_auto,
      'manualScore', v_total_manual,
      'rawScore', v_raw,
      'maxRawScore', v_total_max,
      'pendingManualReviews', v_pending,
      'finalGrade', v_final
    )
  );

  return jsonb_build_object(
    'attemptId', p_attempt_id,
    'autoScore', v_total_auto,
    'manualScore', v_total_manual,
    'rawScore', v_raw,
    'maxRawScore', v_total_max,
    'pendingManualReviews', v_pending,
    'finalGrade', v_final,
    'version', v_version
  );
end;
$$;

create or replace function private.trigger_auto_grade_attempt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.status in ('submitted'::public.attempt_status, 'time_expired'::public.attempt_status)
     and old.status is distinct from new.status then
    begin
      perform private.auto_grade_attempt(new.id);
    exception when others then
      -- Closing the student's attempt must not fail only because grading encountered an error.
      begin
        insert into public.logs(student_id, exam_id, attempt_id, event_type, metadata)
        values (new.student_id, new.exam_id, new.id, 'AUTO_GRADING_FAILED', jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm));
      exception when others then
        null;
      end;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_grade_attempt on public.intentos;
create trigger trg_auto_grade_attempt
after update of status on public.intentos
for each row execute function private.trigger_auto_grade_attempt();

-- Internal grading details and frozen keys remain inaccessible to student-facing roles.
revoke all on function private.jsonb_text_array_set_equal(jsonb, jsonb) from public;
revoke all on function private.normalize_grade_text(text, jsonb) from public;
revoke all on function private.answer_json_present(public.question_type, jsonb) from public;
revoke all on function private.auto_grade_attempt(uuid) from public;
revoke all on function private.grade_auto_item(public.question_type, numeric, jsonb, text, numeric, jsonb, jsonb) from public;
revoke all on function private.trigger_auto_grade_attempt() from public;
