# Motor de aleatorización — Prompt 07

## Objetivo

Generar un conjunto de preguntas diferente por intento, respetando preguntas fijas y reglas por banco, unidad, tema, subtema, dificultad y tipo.

## Momento de generación

El conjunto se genera en el servidor inmediatamente antes de iniciar el cronómetro. Si la generación falla, el tiempo no comienza.

La función `public.generate_attempt_questions(attempt_id)` es idempotente: si el intento ya tiene preguntas congeladas, devuelve el mismo conjunto en lugar de volver a seleccionar.

## Congelamiento

Cada pregunta seleccionada se copia a `intento_preguntas` con:

- enunciado;
- tipo;
- puntaje;
- imagen;
- orden de presentación;
- alternativas ya ordenadas;
- metadatos;
- configuración de corrección separada.

Una modificación posterior del banco no cambia un intento ya generado.

## Respuestas correctas

`options_snapshot` contiene solo los datos visibles de las alternativas. La corrección se guarda en `grading_snapshot`, que no se entregará al alumno en el motor de examen.

## Reglas solapadas

Las reglas se ejecutan por `rule_order`. Una pregunta ya escogida queda excluida de reglas posteriores. Si una regla no tiene suficientes candidatas restantes, la generación se cancela y el cronómetro no inicia.

Conviene ordenar primero las reglas más específicas y después las más amplias cuando existan solapamientos.

## Casos prácticos

Un `case_group` cuenta como una selección. Sus subpreguntas se congelan dentro del snapshot del caso, separando contenido visible y datos de corrección.

## Integridad

Para programar o activar un examen, la suma de preguntas fijas + cantidades de reglas debe coincidir con `target_question_count`.
