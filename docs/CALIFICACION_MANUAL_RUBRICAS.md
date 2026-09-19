# Calificación manual y rúbricas — Prompt 11

## Objetivo

El módulo permite revisar respuestas que el motor automático dejó en estado `pending`, asignar puntaje, registrar retroalimentación y cerrar la nota final cuando ya no existen respuestas pendientes.

## Regla de puntaje

Una respuesta que requiere revisión manual puede tener un puntaje automático preliminar, por ejemplo un cálculo numérico acompañado de evidencia. Cuando el docente la revisa, el **puntaje manual reemplaza el puntaje automático de esa pregunta**. No se suman ambos valores.

Esto evita que una pregunta de 5 puntos termine aportando más de 5 puntos al examen.

## Cola de revisión

La pantalla `/docente/calificacion` muestra:

- estudiante y código;
- examen e intento;
- número y enunciado de la pregunta;
- respuesta del estudiante;
- evidencia adjunta, cuando existe;
- puntaje máximo;
- puntaje automático preliminar;
- estado pendiente o revisado;
- retroalimentación;
- estado de la nota del intento.

## Rúbricas

La rúbrica es opcional. Cada criterio contiene:

- nombre;
- descripción opcional;
- puntaje máximo;
- puntaje otorgado.

La suma de los puntajes máximos debe coincidir con el puntaje máximo de la pregunta. La suma de los puntajes otorgados se convierte en el puntaje manual final de esa respuesta.

### Rúbricas reutilizables

Las tablas `rubricas` y `rubrica_criterios` permiten guardar una plantilla asociada a una pregunta del banco. Cuando se genera un nuevo intento, un trigger copia la rúbrica vigente a `intento_preguntas.rubric_snapshot`.

El snapshot es inmutable. Por ello, modificar una rúbrica posteriormente no cambia exámenes ya generados.

Un intento antiguo que no tenga snapshot puede evaluarse con una rúbrica ad hoc; el docente puede guardar esa configuración para futuros intentos, sin alterar el intento actual.

## Recalculo de nota

Después de cada revisión se ejecuta `private.recalculate_attempt_grade`.

Para cada pregunta:

- `reviewed` → utiliza `manual_score`;
- cualquier otro estado → utiliza `auto_score`.

Mientras exista por lo menos una respuesta `pending`, `final_grade` permanece en `NULL`.

Cuando la última respuesta pendiente es revisada:

`final_grade = (raw_score / max_raw_score) × grade_scale_max`

## Seguridad

La operación de calificación se realiza mediante la función `public.grade_manual_response`.

La función valida:

- sesión docente autenticada;
- propiedad del examen;
- intento cerrado;
- respuesta pendiente o previamente revisada;
- puntaje dentro del máximo de la pregunta;
- consistencia de la rúbrica;
- suma de puntajes de criterios;
- suma de máximos igual al máximo de la pregunta.

Cada revisión registra `MANUAL_REVIEW_COMPLETED` en `logs`.
