# Motor de calificación automática — Prompt 10

## Objetivo

La corrección automática se ejecuta en el servidor cuando un intento cambia a `submitted` o `time_expired`. El navegador no recibe `grading_snapshot`, claves correctas ni detalles internos de corrección.

## Tipos corregidos automáticamente

| Tipo | Regla |
|---|---|
| Alternativa única | coincidencia exacta con la opción correcta |
| Imagen + alternativas | coincidencia exacta con la opción correcta |
| Selección múltiple | conjunto exacto de opciones correctas; el orden no importa |
| Verdadero/Falso | comparación booleana |
| Respuesta corta | una de las variantes aceptadas según normalización configurada |
| Numérica | exacta, tolerancia ± o intervalo inclusivo |
| Cálculo + resultado | misma lógica numérica |
| Cálculo + evidencia | corrige el resultado numérico y deja la evidencia pendiente de revisión |

`essay`, `image_essay` y `attachment` no reciben puntaje automático. Si fueron respondidas, quedan con `review_status = pending`.

## Respuesta corta

El docente puede configurar:

- coincidencia exacta o sin distinguir mayúsculas/minúsculas;
- recorte de espacios al inicio y final;
- normalización de espacios repetidos dentro del texto;
- múltiples respuestas aceptables.

No se aplican sinónimos, similitud semántica ni IA. La corrección es determinista.

## Respuestas numéricas

### Exacta

Ejemplo: respuesta esperada `25.5`. Solo ese valor obtiene el puntaje.

### Tolerancia

Ejemplo: `25 ± 0.5`. Se aceptan valores desde `24.5` hasta `25.5`, incluidos ambos extremos.

### Intervalo

Ejemplo: mínimo `24.5`, máximo `25.5`. Se acepta cualquier valor dentro del intervalo, incluidos los límites.

El alumno puede usar punto o coma decimal (`25.5` o `25,5`). Valores que mezclan ambos separadores se rechazan por ambigüedad.

## Selección múltiple

En esta versión no existe crédito parcial. La respuesta obtiene el puntaje completo únicamente cuando el conjunto marcado coincide exactamente con todas las opciones correctas y no contiene opciones adicionales.

## Cierre y disparo de la corrección

La migración `0015_auto_grading_engine.sql` instala `trg_auto_grade_attempt` sobre `intentos`. El trigger se ejecuta cuando el estado cambia a:

- `submitted`;
- `time_expired`.

Esto cubre el envío voluntario y el cierre por tiempo.

## Datos almacenados

En `respuestas`:

- `is_correct`;
- `auto_score`;
- `review_status`;
- `auto_grading_details`;
- `auto_graded_at`;
- `auto_grading_version`.

En `calificaciones`:

- `auto_score`;
- `manual_score`;
- `raw_score`;
- `max_raw_score`;
- `final_grade`;
- `pending_manual_reviews`;
- `auto_graded_at`;
- `auto_grading_version`.

`auto_grading_details` no es enviado al estudiante.

## Nota final

Cuando no existen revisiones manuales pendientes:

`nota = (puntaje obtenido / puntaje máximo) × escala máxima`

La escala máxima se congela al preparar el intento. Si existen respuestas pendientes de revisión, `final_grade` permanece `NULL` hasta la etapa de revisión manual del Prompt 11.

## Casos prácticos

Las subpreguntas automáticas de un `case_group` se corrigen individualmente y sus puntajes se suman. Si el caso contiene una subpregunta manual respondida, el caso queda pendiente de revisión manual sin perder el puntaje automático ya calculado.

## Publicación al alumno

La Edge Function solo devuelve un resumen conforme a `result_visibility` y `show_results_after`:

- `confirmation_only`: no muestra puntaje;
- `score_only`: muestra puntaje bruto;
- `grade`: puede mostrar nota cuando ya no hay revisiones manuales pendientes;
- `correct_answers` y `full_feedback`: por ahora muestran el mismo resumen de nota; la publicación detallada de respuestas se completa en la etapa de resultados.

Nunca se devuelve la clave correcta como parte del motor de resolución.
