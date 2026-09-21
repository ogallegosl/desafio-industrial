-- 0031_grade_cap_and_evidence_pdf.sql
-- Configurable final-grade cap (stored in configuraciones_examen.settings.grading.finalGradeCap)
-- and hard server-side enforcement for every grade write.

create or replace function private.validate_exam_grade_cap_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_raw text;
  v_cap numeric;
begin
  v_raw := nullif(btrim(coalesce(new.settings #>> '{grading,finalGradeCap}', '')), '');
  if v_raw is null then
    return new;
  end if;

  begin
    v_cap := v_raw::numeric;
  exception when others then
    raise exception 'La nota maxima permitida debe ser numerica.';
  end;

  if v_cap <= 0 then
    raise exception 'La nota maxima permitida debe ser mayor que cero.';
  end if;

  if v_cap > new.grade_scale_max then
    raise exception 'La nota maxima permitida no puede superar la escala de calificacion.';
  end if;

  if v_cap < new.passing_grade then
    raise exception 'La nota maxima permitida no puede ser menor que la nota aprobatoria.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_configuraciones_examen_validate_grade_cap on public.configuraciones_examen;
create trigger trg_configuraciones_examen_validate_grade_cap
before insert or update of settings, grade_scale_max, passing_grade
on public.configuraciones_examen
for each row
execute function private.validate_exam_grade_cap_settings();

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
  if new.final_grade is null then
    return new;
  end if;

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
  new.final_grade := least(new.final_grade, v_cap);
  return new;
end;
$$;

drop trigger if exists trg_calificaciones_apply_final_grade_cap on public.calificaciones;
create trigger trg_calificaciones_apply_final_grade_cap
before insert or update of final_grade, attempt_id
on public.calificaciones
for each row
execute function private.apply_attempt_final_grade_cap();

revoke all on function private.validate_exam_grade_cap_settings() from public, anon, authenticated;
revoke all on function private.apply_attempt_final_grade_cap() from public, anon, authenticated;
