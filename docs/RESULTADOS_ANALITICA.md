# Resultados y analítica — Prompt 12

## Alcance

El módulo de resultados consulta datos reales de Supabase y presenta tres niveles de análisis:

1. Resumen del examen.
2. Resultados por pregunta.
3. Resultados por estudiante/intento.

## Unidad de análisis

- **Participantes**: estudiantes únicos con al menos un intento no cancelado.
- **Intentos**: cada ejecución registrada del examen. Si se permiten varios intentos, un estudiante puede aportar más de uno.
- **Estadísticos de nota**: se calculan únicamente con intentos cerrados cuya `final_grade` ya existe.
- **Revisiones manuales pendientes**: se muestran por separado y no se sustituyen por una nota inventada.

## Resumen

Incluye:

- participantes únicos;
- intentos registrados;
- intentos cerrados;
- entregados;
- vencidos por tiempo;
- en curso;
- sin iniciar;
- promedio;
- mediana;
- mínimo;
- máximo;
- desviación estándar poblacional;
- porcentaje de aprobación;
- tiempo medio;
- respuestas pendientes de revisión manual.

El porcentaje de aprobación usa la `passing_grade` configurada en el examen.

## Análisis por pregunta

Para preguntas con corrección objetiva se calcula:

- exposiciones;
- correctas;
- incorrectas;
- omitidas;
- tasa de acierto;
- dificultad observada;
- puntaje medio porcentual.

La **dificultad observada** se define en este módulo como:

`100 % - tasa de acierto`

Por tanto, un valor mayor indica que menos estudiantes resolvieron correctamente el ítem.

En preguntas de desarrollo u otras de evaluación manual no se inventa una clasificación correcta/incorrecta. En esos casos se muestra el rendimiento medio por puntaje y las revisiones pendientes.

## Resultados por estudiante

Cada fila representa un intento y muestra:

- código;
- nombre;
- sección;
- número de intento;
- estado;
- correctas;
- incorrectas;
- omitidas;
- puntaje bruto;
- nota final, cuando existe;
- revisiones pendientes;
- tiempo utilizado.

## Seguridad

Las funciones analíticas son `SECURITY DEFINER`, pero antes de devolver información verifican `auth.uid()` y `private.owns_exam(p_exam_id)`. Solo docentes propietarios del examen o administradores autorizados pueden consultar sus resultados.

## Funciones SQL

- `get_exam_overview(uuid)`
- `get_exam_question_analytics(uuid)`
- `get_exam_student_results(uuid)`

La exportación a Excel/CSV se implementará en el Prompt 13.
