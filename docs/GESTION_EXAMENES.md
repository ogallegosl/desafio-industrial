# Gestión docente de exámenes — Prompt 04

## Alcance implementado

El panel docente dejó de utilizar exámenes ficticios y ahora trabaja con las tablas reales de Supabase.

### Cursos

Se incorporó una gestión mínima de cursos para que una instalación nueva pueda crear evaluaciones sin precargar datos manualmente. El docente puede:

- crear un curso;
- editar nombre, código, periodo, sección y descripción;
- archivar y reactivar cursos.

Los exámenes nuevos solo muestran cursos activos en el selector.

### Exámenes

El docente puede:

- crear un examen en borrador;
- editarlo;
- duplicarlo;
- programarlo;
- activarlo;
- desactivarlo;
- cerrarlo;
- archivarlo;
- eliminarlo lógicamente.

La eliminación lógica utiliza `is_deleted=true` y `deleted_at`, por lo que no borra intentos ni resultados históricos.

## Configuración guardada

### Información general

- título;
- curso;
- descripción;
- instrucciones.

### Acceso y horario

- código de acceso protegido mediante hash;
- inicio;
- cierre;
- duración por intento;
- máximo de intentos;
- campos de identificación del estudiante;
- restricción opcional a estudiantes matriculados.

El código existente nunca se recupera en texto plano. Al editar, el docente puede conservarlo, sustituirlo o retirarlo si el estado del examen lo permite.

### Preguntas

Se almacena:

- cantidad objetivo de preguntas;
- aleatorización de preguntas;
- aleatorización de alternativas.

La selección detallada de bancos y preguntas corresponde a los Prompts 05 y 07. El editor muestra cuántas preguntas fijas y cuántas reglas aleatorias están actualmente vinculadas.

### Navegación

- libre;
- secuencial;
- permitir o impedir volver atrás en modo secuencial;
- envío automático cuando expire el tiempo.

### Resultados

Opciones de visibilidad:

- solo confirmación;
- puntaje;
- nota;
- respuestas correctas;
- retroalimentación completa.

También se guardan:

- fecha a partir de la cual se mostrarán resultados;
- escala máxima;
- nota aprobatoria.

## Controles de publicación

La migración `0010_exam_management.sql` añade validación a nivel de PostgreSQL.

Un examen no puede pasar a `scheduled` o `active` si:

- está eliminado;
- no tiene código de acceso;
- no tiene fecha/hora de inicio y cierre;
- el cierre no es posterior al inicio;
- la fecha de cierre ya pasó;
- no tiene configuración;
- duración o cantidad objetivo no son positivas.

Estas comprobaciones se ejecutan en la base de datos y no dependen exclusivamente del navegador.

## Duplicación

`duplicate_exam(uuid)` crea de forma atómica:

- nuevo examen en estado `draft`;
- copia de configuración;
- copia de preguntas fijas existentes;
- copia de reglas de selección existentes.

No copia:

- código de acceso;
- fechas y horario;
- intentos;
- respuestas;
- resultados.

Esto evita activar accidentalmente una copia con el mismo acceso que el examen original.

## Dashboard

El dashboard obtiene de Supabase:

- exámenes activos;
- exámenes próximos durante siete días;
- intentos registrados;
- respuestas pendientes de revisión;
- exámenes recientes.
