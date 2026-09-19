-- 0022_safety_demo_exam.sql
-- Prompt 16: idempotent demo course, question bank and integrated Industrial Safety exam.

create or replace function private.demo_insert_question(
  p_bank_id uuid,
  p_owner_user_id uuid,
  p_type public.question_type,
  p_prompt text,
  p_unit text,
  p_topic text,
  p_subtopic text,
  p_difficulty public.question_difficulty,
  p_points numeric,
  p_answer_key jsonb default '{}'::jsonb,
  p_numeric_tolerance numeric default null,
  p_explanation text default null,
  p_grading_config jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_options jsonb default '[]'::jsonb,
  p_parent_question_id uuid default null,
  p_case_position integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_option jsonb;
  v_position integer := 0;
begin
  insert into public.preguntas(
    id, bank_id, type, prompt, unit, topic, subtopic, difficulty, points,
    answer_key, numeric_tolerance, explanation, grading_config, metadata,
    is_active, created_by_user_id, parent_question_id, case_position
  ) values (
    v_id, p_bank_id, p_type, p_prompt, p_unit, p_topic, p_subtopic, p_difficulty, p_points,
    coalesce(p_answer_key, '{}'::jsonb), p_numeric_tolerance, p_explanation,
    coalesce(p_grading_config, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('demo', true, 'demoVersion', 1),
    true, p_owner_user_id, p_parent_question_id, p_case_position
  );

  for v_option in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) value loop
    insert into public.alternativas(question_id, option_key, content, is_correct, position)
    values (
      v_id,
      coalesce(nullif(v_option->>'key', ''), chr(65 + v_position)),
      v_option->>'content',
      coalesce((v_option->>'correct')::boolean, false),
      v_position
    );
    v_position := v_position + 1;
  end loop;

  return v_id;
end;
$$;

revoke all on function private.demo_insert_question(uuid, uuid, public.question_type, text, text, text, text, public.question_difficulty, numeric, jsonb, numeric, text, jsonb, jsonb, jsonb, uuid, integer) from public, anon, authenticated;

create or replace function public.create_safety_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_teacher_id uuid;
  v_course_id uuid;
  v_bank_id uuid;
  v_exam_id uuid;
  v_q uuid;
  v_case uuid;
  v_code text;
  v_marker text := '[DEMO_DATA_PROMPT16]';
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'ACTIVE_TEACHER_REQUIRED';
  end if;

  select e.id, e.course_id
    into v_exam_id, v_course_id
  from public.examenes e
  where e.owner_user_id = v_user_id
    and e.is_deleted = false
    and e.description like '%' || v_marker || '%'
  order by e.created_at desc
  limit 1;

  if v_exam_id is not null then
    v_code := 'SEG' || upper(substr(replace(v_user_id::text, '-', ''), 1, 8)) || upper(substr(replace(v_exam_id::text, '-', ''), 1, 4));

    update public.configuraciones_examen
    set duration_minutes = 45,
        max_attempts = 3,
        target_question_count = 15,
        randomize_questions = true,
        randomize_options = true,
        navigation = 'free'::public.navigation_mode,
        allow_backtrack = true,
        auto_submit_on_timeout = true,
        result_visibility = 'full_feedback'::public.result_visibility,
        show_results_after = now(),
        require_student_code = true,
        require_first_name = true,
        require_last_name = true,
        require_email = false,
        require_section = false,
        restrict_to_enrolled_students = false,
        grade_scale_max = 20,
        passing_grade = 10.5,
        settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('demo', true, 'demoVersion', 1)
    where exam_id = v_exam_id;

    update public.examenes
    set access_code_lookup = encode(extensions.digest(v_code, 'sha256'), 'hex'),
        access_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 10)),
        access_code_hint = 'Código DEMO generado automáticamente',
        starts_at = now() - interval '5 minutes',
        ends_at = now() + interval '30 days',
        status = 'active'::public.exam_status,
        updated_at = now()
    where id = v_exam_id;

    return jsonb_build_object(
      'created', false,
      'examId', v_exam_id,
      'courseId', v_course_id,
      'accessCode', v_code,
      'questionCount', 15,
      'message', 'El examen DEMO ya existía; se reactivó su ventana de prueba.'
    );
  end if;

  insert into public.cursos(
    docente_id, code, name, description, academic_period, section, is_active
  ) values (
    v_teacher_id,
    'DEMO-SEG-IND',
    '[DEMO] Ingeniería de Seguridad',
    v_marker || ' Curso generado para probar integralmente EvaluaLab. Puede archivarse o eliminarse después de las pruebas.',
    'DEMO 2026',
    'DEMO',
    true
  ) returning id into v_course_id;

  insert into public.bancos_preguntas(
    course_id, owner_user_id, name, description, is_archived
  ) values (
    v_course_id,
    v_user_id,
    '[DEMO] Banco integral de Seguridad',
    v_marker || ' Preguntas de prueba sobre peligros, riesgos, IPERC, ruido, iluminación, ergonomía y manipulación manual de cargas.',
    false
  ) returning id into v_bank_id;

  insert into public.examenes(
    course_id, owner_user_id, title, description, instructions,
    starts_at, ends_at, status, is_deleted
  ) values (
    v_course_id,
    v_user_id,
    '[DEMO] Examen integral — Ingeniería de Seguridad',
    v_marker || ' Examen de demostración. No usar sus resultados como evaluación académica real.',
    'Este examen DEMO sirve para comprobar preguntas automáticas, desarrollo, imágenes, cálculos, evidencias y casos. Tiempo: 45 minutos. Escala: 0–20.',
    now() - interval '5 minutes',
    now() + interval '30 days',
    'draft'::public.exam_status,
    false
  ) returning id into v_exam_id;

  v_code := 'SEG' || upper(substr(replace(v_user_id::text, '-', ''), 1, 8)) || upper(substr(replace(v_exam_id::text, '-', ''), 1, 4));

  insert into public.configuraciones_examen(
    exam_id, duration_minutes, max_attempts, target_question_count,
    randomize_questions, randomize_options, navigation, allow_backtrack,
    auto_submit_on_timeout, result_visibility, show_results_after,
    require_student_code, require_first_name, require_last_name, require_email,
    require_section, restrict_to_enrolled_students, grade_scale_max,
    passing_grade, settings
  ) values (
    v_exam_id, 45, 3, 15,
    true, true, 'free'::public.navigation_mode, true,
    true, 'full_feedback'::public.result_visibility, now(),
    true, true, true, false,
    false, false, 20, 10.5,
    jsonb_build_object('demo', true, 'demoVersion', 1)
  );

  update public.examenes
  set access_code_lookup = encode(extensions.digest(v_code, 'sha256'), 'hex'),
      access_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 10)),
      access_code_hint = 'Código DEMO generado automáticamente'
  where id = v_exam_id;

  -- Q01: alternativa única
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'single_choice',
    '¿Cuál de las siguientes expresiones describe correctamente un peligro?',
    'Unidad 1', 'Peligros y riesgos', 'Conceptos básicos', 'basic', 1,
    jsonb_build_object('optionKey','B'), null,
    'Un peligro es una fuente, situación o acto con potencial de causar daño.', '{}',
    jsonb_build_object('demoKey','Q01'),
    '[{"key":"A","content":"La probabilidad de que ocurra un daño","correct":false},{"key":"B","content":"Una fuente, situación o acto con potencial de causar daño","correct":true},{"key":"C","content":"La consecuencia económica de un accidente","correct":false},{"key":"D","content":"El registro estadístico de incidentes","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,1); v_count := v_count + 1;

  -- Q02: verdadero/falso
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'true_false',
    'En una matriz IPERC, identificar el peligro debe realizarse antes de valorar el nivel de riesgo.',
    'Unidad 1', 'IPERC', 'Secuencia de evaluación', 'basic', 1,
    jsonb_build_object('value', true), null,
    'Primero se identifica el peligro; luego se estima y valora el riesgo.', '{}',
    jsonb_build_object('demoKey','Q02'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,2); v_count := v_count + 1;

  -- Q03: jerarquía de controles
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'single_choice',
    'Según la jerarquía de controles, ¿qué medida debe priorizarse cuando técnicamente es posible eliminar por completo la fuente de peligro?',
    'Unidad 1', 'Controles', 'Jerarquía de controles', 'intermediate', 1,
    jsonb_build_object('optionKey','A'), null,
    'La eliminación se ubica en el nivel más alto de la jerarquía de controles.', '{}',
    jsonb_build_object('demoKey','Q03'),
    '[{"key":"A","content":"Eliminación","correct":true},{"key":"B","content":"Equipo de protección personal","correct":false},{"key":"C","content":"Señalización","correct":false},{"key":"D","content":"Capacitación únicamente","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,3); v_count := v_count + 1;

  -- Q04: numérica con tolerancia
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'numeric',
    'En cinco puntos de un ambiente se midieron 300, 320, 280, 310 y 290 lux. Calcule la iluminancia promedio en lux.',
    'Unidad 2', 'Iluminación', 'Promedio de mediciones', 'intermediate', 1.5,
    jsonb_build_object('value',300), 0.5,
    'La media es (300+320+280+310+290)/5 = 300 lux.',
    jsonb_build_object('numericMode','tolerance'), jsonb_build_object('demoKey','Q04'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,4); v_count := v_count + 1;

  -- Q05: numérica exacta
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'numeric',
    'Una matriz de riesgo utiliza R = Probabilidad × Severidad. Si P = 3 y S = 4, ¿cuál es el valor de R?',
    'Unidad 1', 'IPERC', 'Valoración del riesgo', 'basic', 1,
    jsonb_build_object('value',12), null,
    'R = 3 × 4 = 12.', jsonb_build_object('numericMode','exact'), jsonb_build_object('demoKey','Q05'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,5); v_count := v_count + 1;

  -- Q06: imagen + alternativa
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'image_single_choice',
    'Observe la escena. ¿Cuál es la deficiencia más evidente respecto al equipo contra incendios?',
    'Unidad 3', 'Inspecciones de seguridad', 'Condiciones subestándar', 'intermediate', 1.5,
    jsonb_build_object('optionKey','C'), null,
    'El extintor está parcialmente bloqueado por cajas, reduciendo su accesibilidad.', '{}',
    jsonb_build_object('demoKey','Q06','demoMediaUrl','/demo/seguridad-almacen.svg'),
    '[{"key":"A","content":"El extintor tiene un color inadecuado","correct":false},{"key":"B","content":"No existe señalización de tránsito vehicular","correct":false},{"key":"C","content":"El acceso al extintor está obstruido por cajas","correct":true},{"key":"D","content":"La estantería debería ser de otro material","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,6); v_count := v_count + 1;

  -- Q07: desarrollo
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'essay',
    'Explique la diferencia entre peligro y riesgo utilizando un ejemplo de un taller de mantenimiento.',
    'Unidad 1', 'Peligros y riesgos', 'Aplicación conceptual', 'intermediate', 1.5,
    '{}'::jsonb, null,
    'Criterio sugerido: identificar claramente la fuente de daño y diferenciarla de la combinación probabilidad-consecuencia.',
    jsonb_build_object('manualReview',true), jsonb_build_object('demoKey','Q07'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,7); v_count := v_count + 1;

  -- Q08: cálculo
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'calculation',
    'Para una exposición simplificada se usa D = (C/T) × 100. Si un trabajador estuvo C = 3 horas y el tiempo permitido T = 6 horas, calcule D (%).',
    'Unidad 2', 'Ruido', 'Cálculo de dosis simplificada', 'intermediate', 1.5,
    jsonb_build_object('value',50), 0.5,
    'D = (3/6) × 100 = 50 %.', jsonb_build_object('numericMode','tolerance'), jsonb_build_object('demoKey','Q08'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,8); v_count := v_count + 1;

  -- Q09: cálculo + evidencia
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'calculation_evidence',
    'Use D = (C/T) × 100. Si C = 2 horas y T = 4 horas, calcule la dosis (%) y adjunte una fotografía o PDF de su procedimiento.',
    'Unidad 2', 'Ruido', 'Cálculo con evidencia', 'intermediate', 2,
    jsonb_build_object('value',50), 0.5,
    'D = (2/4) × 100 = 50 %. La evidencia permite revisar el procedimiento.',
    jsonb_build_object('numericMode','tolerance','requireEvidence',true), jsonb_build_object('demoKey','Q09'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,9); v_count := v_count + 1;

  -- Q10: selección múltiple
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'multiple_choice',
    'Seleccione las DOS situaciones que representan principalmente factores de riesgo ergonómico.',
    'Unidad 4', 'Ergonomía', 'Factores de riesgo', 'intermediate', 1.5,
    jsonb_build_object('optionKeys',jsonb_build_array('A','C')), null,
    'Las posturas forzadas y la manipulación manual repetitiva de cargas son factores ergonómicos.', '{}',
    jsonb_build_object('demoKey','Q10'),
    '[{"key":"A","content":"Posturas forzadas mantenidas","correct":true},{"key":"B","content":"Contacto con un conductor energizado","correct":false},{"key":"C","content":"Levantamiento repetitivo de cargas","correct":true},{"key":"D","content":"Exposición a vapores corrosivos","correct":false}]'::jsonb);
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,10); v_count := v_count + 1;

  -- Q11: respuesta corta
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'short_text',
    'Escriba únicamente la sigla del proceso de Identificación de Peligros, Evaluación de Riesgos y Controles.',
    'Unidad 1', 'IPERC', 'Terminología', 'basic', 1,
    jsonb_build_object('answers',jsonb_build_array('IPERC','IPER-C')), null,
    'La sigla esperada es IPERC.',
    jsonb_build_object('mode','case_insensitive','trimWhitespace',true,'collapseWhitespace',true), jsonb_build_object('demoKey','Q11'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,11); v_count := v_count + 1;

  -- Q12: verdadero/falso iluminación
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'true_false',
    'El lux (lx) es una unidad utilizada para expresar iluminancia.',
    'Unidad 2', 'Iluminación', 'Unidades', 'basic', 1,
    jsonb_build_object('value',true), null,
    'El lux es la unidad del SI para iluminancia.', '{}', jsonb_build_object('demoKey','Q12'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,12); v_count := v_count + 1;

  -- Q13: imagen + desarrollo
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'image_essay',
    'Observe la escena de almacén e identifique dos condiciones inseguras distintas. Para cada una, indique una medida de control concreta.',
    'Unidad 3', 'Inspecciones de seguridad', 'Análisis visual', 'advanced', 1.5,
    '{}'::jsonb, null,
    'Ejemplos visibles: extintor obstruido, cable atravesando zona de paso y almacenamiento/apilamiento que requiere revisión.',
    jsonb_build_object('manualReview',true),
    jsonb_build_object('demoKey','Q13','demoMediaUrl','/demo/seguridad-almacen.svg'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,13); v_count := v_count + 1;

  -- Q14: archivo adjunto
  v_q := private.demo_insert_question(v_bank_id, v_user_id, 'attachment',
    'Adjunte una hoja, fotografía o PDF con un mini-IPERC de una actividad de manipulación manual de cargas. Debe contener como mínimo peligro, riesgo y un control propuesto.',
    'Unidad 4', 'Manipulación manual de cargas', 'Evidencia aplicada', 'advanced', 1,
    '{}'::jsonb, null,
    'Revisión manual del archivo adjunto.', jsonb_build_object('manualReview',true,'requireAttachment',true), jsonb_build_object('demoKey','Q14'));
  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_q,14); v_count := v_count + 1;

  -- Q15: caso con dos subpreguntas
  v_case := private.demo_insert_question(v_bank_id, v_user_id, 'case_group',
    'CASO DEMO: En un área de despacho, un trabajador desplaza manualmente cajas de 20 kg durante el turno. El pasillo tiene materiales en el piso y el supervisor observa posturas de flexión frecuente del tronco. Responda las subpreguntas.',
    'Unidad 4', 'Ergonomía', 'Caso integrado', 'advanced', 2,
    '{}'::jsonb, null,
    'Caso para integrar identificación del peligro y valoración básica.', jsonb_build_object('manualReview',true), jsonb_build_object('demoKey','Q15'));

  perform private.demo_insert_question(v_bank_id, v_user_id, 'single_choice',
    '¿Cuál es el peligro ergonómico más directamente descrito en el caso?',
    'Unidad 4', 'Ergonomía', 'Caso integrado', 'intermediate', 1,
    jsonb_build_object('optionKey','B'), null,
    'La manipulación manual de cargas y la flexión frecuente del tronco constituyen el peligro ergonómico principal.', '{}',
    jsonb_build_object('demoKey','Q15A'),
    '[{"key":"A","content":"Radiación ionizante","correct":false},{"key":"B","content":"Manipulación manual de cargas y posturas forzadas","correct":true},{"key":"C","content":"Exposición biológica","correct":false},{"key":"D","content":"Ruido impulsivo","correct":false}]'::jsonb,
    v_case, 1);

  perform private.demo_insert_question(v_bank_id, v_user_id, 'numeric',
    'Si para un ejercicio didáctico se asigna Probabilidad = 3 y Severidad = 3, y se usa R = P × S, ¿qué valor obtiene?',
    'Unidad 4', 'IPERC', 'Caso integrado', 'intermediate', 1,
    jsonb_build_object('value',9), null,
    'R = 3 × 3 = 9.', jsonb_build_object('numericMode','exact'),
    jsonb_build_object('demoKey','Q15B'), '[]'::jsonb,
    v_case, 2);

  insert into public.preguntas_examen(exam_id,question_id,fixed_position) values(v_exam_id,v_case,15); v_count := v_count + 1;

  if v_count <> 15 then
    raise exception 'DEMO_QUESTION_COUNT_MISMATCH:%', v_count;
  end if;

  update public.examenes
  set status = 'active'::public.exam_status,
      updated_at = now()
  where id = v_exam_id;

  return jsonb_build_object(
    'created', true,
    'courseId', v_course_id,
    'bankId', v_bank_id,
    'examId', v_exam_id,
    'accessCode', v_code,
    'questionCount', v_count,
    'activeUntil', now() + interval '30 days',
    'message', 'Examen DEMO creado y activado.'
  );
end;
$$;

revoke all on function public.create_safety_demo() from public, anon;
grant execute on function public.create_safety_demo() to authenticated;

comment on function public.create_safety_demo() is
'Creates an idempotent Industrial Safety demo course, bank and 15-question exam for the authenticated active teacher.';
