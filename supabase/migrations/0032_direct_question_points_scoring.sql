-- 0032_direct_question_points_scoring.sql
-- El puntaje de cada pregunta constituye directamente la nota final.
-- La suma del plan debe coincidir exactamente con la nota maxima configurada
-- (20 por defecto; un valor menor, como 15, puede usarse de forma excepcional).

create or replace function private.exam_scoring_plan_summary(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_exam public.examenes%rowtype;
  v_rule public.reglas_seleccion_examen%rowtype;
  v_fixed_total numeric := 0;
  v_random_total numeric := 0;
  v_candidate_count integer := 0;
  v_min_points numeric;
  v_max_points numeric;
  v_per_question numeric;
  v_deterministic boolean := true;
  v_issue text := null;
begin
  select * into v_exam
  from public.examenes
  where id = p_exam_id and is_deleted = false;

  if not found then
    raise exception 'EXAM_NOT_FOUND';
  end if;

  select coalesce(sum(coalesce(pe.points_override, q.points)), 0)
  into v_fixed_total
  from public.preguntas_examen pe
  join public.preguntas q on q.id = pe.question_id
  join public.bancos_preguntas b on b.id = q.bank_id
  where pe.exam_id = p_exam_id
    and b.course_id = v_exam.course_id
    and b.is_archived = false
    and q.is_active = true
    and q.parent_question_id is null;

  for v_rule in
    select *
    from public.reglas_seleccion_examen
    where exam_id = p_exam_id
    order by rule_order, id
  loop
    if v_rule.points_override is not null then
      v_per_question := v_rule.points_override;
    else
      select count(*), min(q.points), max(q.points)
      into v_candidate_count, v_min_points, v_max_points
      from public.preguntas q
      join public.bancos_preguntas b on b.id = q.bank_id
      where b.course_id = v_exam.course_id
        and b.is_archived = false
        and q.is_active = true
        and q.parent_question_id is null
        and (v_rule.bank_id is null or q.bank_id = v_rule.bank_id)
        and (v_rule.unit is null or q.unit = v_rule.unit)
        and (v_rule.topic is null or q.topic = v_rule.topic)
        and (v_rule.subtopic is null or q.subtopic = v_rule.subtopic)
        and (v_rule.difficulty is null or q.difficulty = v_rule.difficulty)
        and (v_rule.question_type is null or q.type = v_rule.question_type)
        and not exists (
          select 1
          from public.preguntas_examen pe
          where pe.exam_id = p_exam_id and pe.question_id = q.id
        );

      if v_candidate_count < v_rule.quantity then
        v_deterministic := false;
        v_issue := coalesce(v_issue, 'Una regla aleatoria no tiene suficientes preguntas candidatas.');
        continue;
      end if;

      if v_min_points is null or v_max_points is null or abs(v_max_points - v_min_points) > 0.001 then
        v_deterministic := false;
        v_issue := coalesce(v_issue, 'Una regla aleatoria contiene preguntas con puntajes distintos y no tiene puntaje por pregunta definido.');
        continue;
      end if;

      v_per_question := v_min_points;
    end if;

    v_random_total := v_random_total + (v_rule.quantity * v_per_question);
  end loop;

  return jsonb_build_object(
    'deterministic', v_deterministic,
    'fixedPoints', round(v_fixed_total, 3),
    'randomPoints', case when v_deterministic then round(v_random_total, 3) else null end,
    'totalPoints', case when v_deterministic then round(v_fixed_total + v_random_total, 3) else null end,
    'issue', v_issue
  );
end;
$$;

create or replace function public.get_exam_scoring_plan_summary(p_exam_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
  select private.exam_scoring_plan_summary(p_exam_id);
$$;

revoke all on function public.get_exam_scoring_plan_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_exam_scoring_plan_summary(uuid) to service_role;

create or replace function private.validate_exam_scoring_before_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_cfg public.configuraciones_examen%rowtype;
  v_summary jsonb;
  v_cap numeric;
  v_total numeric;
begin
  if new.status::text not in ('scheduled', 'active') then
    return new;
  end if;

  select * into v_cfg
  from public.configuraciones_examen
  where exam_id = new.id;

  if not found then
    raise exception 'No existe configuracion para validar el puntaje del examen.';
  end if;

  begin
    v_cap := coalesce(nullif(v_cfg.settings #>> '{grading,finalGradeCap}', '')::numeric, v_cfg.grade_scale_max);
  exception when others then
    v_cap := v_cfg.grade_scale_max;
  end;

  v_summary := private.exam_scoring_plan_summary(new.id);
  if not coalesce((v_summary->>'deterministic')::boolean, false) then
    raise exception '%', coalesce(v_summary->>'issue', 'El puntaje del examen no es determinista.');
  end if;

  v_total := coalesce((v_summary->>'totalPoints')::numeric, 0);
  if abs(v_total - v_cap) > 0.001 then
    raise exception 'La suma de puntajes del examen (%) debe coincidir exactamente con la nota maxima configurada (%).', v_total, v_cap;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_examenes_validate_scoring_before_publish on public.examenes;
create trigger trg_examenes_validate_scoring_before_publish
before insert or update of status
on public.examenes
for each row
execute function private.validate_exam_scoring_before_publish();

-- Conserva las validaciones de 0031 y, si el examen ya esta publicado,
-- impide cambiar la nota maxima a un valor que deje de coincidir con el plan.
create or replace function private.validate_exam_grade_cap_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_raw text;
  v_cap numeric;
  v_status text;
  v_summary jsonb;
  v_total numeric;
begin
  v_raw := nullif(btrim(coalesce(new.settings #>> '{grading,finalGradeCap}', '')), '');
  if v_raw is null then
    v_cap := new.grade_scale_max;
  else
    begin
      v_cap := v_raw::numeric;
    exception when others then
      raise exception 'La nota maxima del examen debe ser numerica.';
    end;
  end if;

  if v_cap <= 0 then
    raise exception 'La nota maxima del examen debe ser mayor que cero.';
  end if;

  if v_cap > new.grade_scale_max then
    raise exception 'La nota maxima del examen no puede superar la escala institucional.';
  end if;

  if v_cap < new.passing_grade then
    raise exception 'La nota maxima del examen no puede ser menor que la nota aprobatoria.';
  end if;

  select status::text into v_status
  from public.examenes
  where id = new.exam_id;

  if v_status in ('scheduled', 'active') then
    v_summary := private.exam_scoring_plan_summary(new.exam_id);
    if not coalesce((v_summary->>'deterministic')::boolean, false) then
      raise exception '%', coalesce(v_summary->>'issue', 'El puntaje del examen no es determinista.');
    end if;
    v_total := coalesce((v_summary->>'totalPoints')::numeric, 0);
    if abs(v_total - v_cap) > 0.001 then
      raise exception 'La suma de puntajes del examen (%) debe coincidir exactamente con la nota maxima configurada (%).', v_total, v_cap;
    end if;
  end if;

  return new;
end;
$$;

-- La fila de calificaciones queda protegida por la misma regla. Para intentos
-- nuevos, max_raw_score coincide con la nota maxima y final_grade = raw_score.
-- Los intentos historicos con otra escala conservan el comportamiento previo.
create or replace function private.apply_attempt_final_grade_cap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_frozen jsonb;
  v_settings jsonb;
  v_scale numeric;
  v_cap numeric;
  v_raw text;
begin
  select i.frozen_exam_config, c.settings, c.grade_scale_max
  into v_frozen, v_settings, v_scale
  from public.intentos i
  join public.configuraciones_examen c on c.exam_id = i.exam_id
  where i.id = new.attempt_id;

  if not found then
    return new;
  end if;

  v_raw := nullif(btrim(coalesce(v_frozen->>'finalGradeCap', '')), '');
  if v_raw is null then
    v_raw := nullif(btrim(coalesce(v_settings #>> '{grading,finalGradeCap}', '')), '');
  end if;

  begin
    v_cap := coalesce(v_raw::numeric, v_scale);
  exception when others then
    v_cap := v_scale;
  end;

  v_cap := greatest(0, least(v_cap, v_scale));

  if coalesce(new.pending_manual_reviews, 0) > 0 then
    new.final_grade := null;
    return new;
  end if;

  if new.raw_score is not null
     and new.max_raw_score is not null
     and abs(new.max_raw_score - v_cap) <= 0.001 then
    new.final_grade := round(least(greatest(new.raw_score, 0), v_cap), 3);
  elsif new.final_grade is not null then
    new.final_grade := least(new.final_grade, v_cap);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_calificaciones_apply_final_grade_cap on public.calificaciones;
create trigger trg_calificaciones_apply_final_grade_cap
before insert or update of final_grade, attempt_id, raw_score, max_raw_score, pending_manual_reviews
on public.calificaciones
for each row
execute function private.apply_attempt_final_grade_cap();

revoke all on function private.exam_scoring_plan_summary(uuid) from public, anon, authenticated;
revoke all on function private.validate_exam_scoring_before_publish() from public, anon, authenticated;
revoke all on function private.validate_exam_grade_cap_settings() from public, anon, authenticated;
revoke all on function private.apply_attempt_final_grade_cap() from public, anon, authenticated;
