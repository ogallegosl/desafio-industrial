# Base de datos — Sistema de Evaluación Virtual

## 1. Decisión de diseño

La base se implementa en PostgreSQL mediante Supabase. El modelo separa:

- identidad docente;
- estudiantes;
- cursos y matrículas;
- bancos y preguntas;
- exámenes y reglas de selección;
- intentos;
- preguntas congeladas por intento;
- respuestas;
- evidencias;
- calificaciones;
- auditoría.

Las respuestas correctas se consideran información sensible. Por ello, los estudiantes no consultarán directamente las tablas `preguntas`, `alternativas` o `intento_preguntas`. En esta etapa esas tablas no tienen políticas `anon`.

El acceso del estudiante se habilitará mediante funciones controladas en las etapas de autenticación y motor de examen.

## 2. Diagrama lógico resumido

```text
auth.users
   |
usuarios ── docentes ── cursos ── matriculas ── estudiantes
                    |
                    ├── bancos_preguntas ── preguntas ── alternativas
                    |
                    └── examenes
                         ├── configuraciones_examen
                         ├── preguntas_examen
                         ├── reglas_seleccion_examen
                         └── intentos ── intento_preguntas ── respuestas ── evidencias
                                      |
                                      └── calificaciones

logs registra eventos asociados a examen, intento, estudiante o docente.
```

## 3. Tablas

### usuarios

Extiende `auth.users` para información de aplicación. Solo contempla cuentas autenticadas administrativas/docentes en la primera versión.

Campos principales:

- `id`;
- `role`;
- `first_name`;
- `last_name`;
- `email`;
- `is_active`.

### docentes

Perfil docente asociado uno a uno con `usuarios`.

### estudiantes

Entidad independiente de Supabase Auth. Esto permite que un alumno rinda un examen sin crear obligatoriamente una cuenta completa.

Incluye:

- código;
- nombres;
- apellidos;
- correo;
- sección;
- creador;
- metadatos.

### cursos

Pertenece a un docente.

### matriculas

Relaciona estudiante y curso.

### bancos_preguntas

Agrupa preguntas de un curso.

### preguntas

Incluye:

- tipo;
- enunciado;
- unidad;
- tema;
- subtema;
- dificultad;
- recurso multimedia;
- puntaje;
- `answer_key`;
- tolerancia numérica;
- explicación;
- configuración de corrección.

`answer_key` y `grading_config` son campos sensibles.

### alternativas

Cada alternativa tiene:

- contenido;
- posición;
- indicador `is_correct`.

El campo `is_correct` nunca debe entregarse al navegador del estudiante durante un examen activo.

### examenes

Incluye:

- curso;
- título;
- instrucciones;
- ventana temporal;
- estado;
- propietario.

El código de examen se almacena como `access_code_hash`, no como texto plano.

### configuraciones_examen

Incluye:

- duración;
- intentos;
- aleatorización;
- navegación;
- retroceso;
- envío al vencer tiempo;
- visibilidad de resultados;
- identificación requerida;
- escala de nota.

### preguntas_examen

Preguntas fijas incorporadas explícitamente.

### reglas_seleccion_examen

Permite seleccionar aleatoriamente cantidades por:

- banco;
- unidad;
- tema;
- subtema;
- dificultad;
- tipo.

Ejemplo: seleccionar 5 preguntas de IPERC y 3 de ruido.

### intentos

Registra cada intento del alumno.

Campos principales:

- examen;
- estudiante;
- número de intento;
- estado;
- inicio;
- plazo;
- entrega;
- última actividad;
- configuración congelada.

### intento_preguntas

Elemento indispensable para la aleatorización.

Cuando comienza un examen, las preguntas seleccionadas se copian como snapshots:

- enunciado;
- tipo;
- recurso;
- puntaje;
- alternativas;
- configuración de corrección.

La selección queda congelada y no cambia al recargar la página.

El campo `grading_snapshot` es sensible y no debe entregarse al estudiante.

### respuestas

Permite:

- texto;
- valor numérico;
- alternativas;
- payload estructurado;
- resultado automático;
- revisión manual;
- feedback.

### evidencias

Registra metadatos de los archivos. Los bytes se almacenan en Supabase Storage.

### calificaciones

Consolida:

- puntaje automático;
- puntaje manual;
- puntaje bruto;
- nota final;
- publicación;
- retroalimentación.

### resultados

Es una **vista**, no una tabla duplicada.

La decisión evita que el intento y la nota puedan desincronizarse de una copia secundaria.

### logs

Registra eventos como:

- `EXAM_STARTED`;
- `ANSWER_SAVED`;
- `EVIDENCE_UPLOADED`;
- `EXAM_SUBMITTED`;
- `TIME_EXPIRED`.

## 4. Estados de intento

```text
created
in_progress
submitted
time_expired
cancelled
```

Los identificadores de examen, alumno y número de intento quedan inmutables después de crear el intento.

## 4.1. Esquema privado de autorización

Las funciones auxiliares que consultan roles o propiedad (`is_admin`, `owns_course`, `owns_exam`, etc.) se ubican en el esquema `private`, no en `public`.

Se usan como `SECURITY DEFINER` con `search_path = ''` y nombres de relación totalmente calificados. Esto reduce el riesgo de ejecutar objetos sustituidos mediante un `search_path` manipulable.

## 5. RLS

Se activa Row Level Security en todas las tablas sensibles.

### Docente

Puede operar sobre:

- sus cursos;
- sus estudiantes;
- sus bancos;
- sus preguntas;
- sus exámenes;
- intentos correspondientes a sus exámenes;
- respuestas;
- evidencias;
- calificaciones.

### Administrador

Puede consultar y administrar registros mediante funciones de rol.

### Estudiante / anon

En esta etapa no recibe acceso directo a tablas sensibles.

Esto es intencional.

Más adelante, el estudiante interactuará mediante operaciones limitadas que:

- validen el examen;
- creen el intento;
- devuelvan solo la versión segura de las preguntas;
- guarden respuestas sin exponer la clave de corrección.

## 6. Storage

Buckets privados:

### question-media

Admite:

- `image/jpeg`;
- `image/png`;
- `image/webp`.

Límite inicial: 10 MB.

Ruta recomendada:

```text
<teacher-user-id>/<question-id>/<archivo>
```

### student-evidence

Admite:

- JPG;
- PNG;
- WEBP;
- PDF.

Límite inicial: 15 MB.

Ruta recomendada:

```text
<teacher-user-id>/<exam-id>/<attempt-id>/<archivo>
```

No se concede acceso anónimo directo al bucket.

## 7. Orden de migraciones

Ejecutar en orden:

```text
0001_extensions_enums.sql
0002_core_tables.sql
0003_exam_tables.sql
0004_attempt_response_tables.sql
0005_indexes_triggers_functions.sql
0006_rls_policies.sql
0007_storage.sql
0008_integrity_triggers.sql
```

También se genera:

```text
supabase/sql/bootstrap_all.sql
```

que contiene las migraciones concatenadas para una instalación inicial manual.

## 8. Datos que NO deben ir al frontend

Durante un examen activo no se deben devolver:

- `preguntas.answer_key`;
- `preguntas.grading_config`;
- `alternativas.is_correct`;
- `intento_preguntas.grading_snapshot`;
- respuestas de otros estudiantes;
- calificaciones no publicadas.

## 9. Código de acceso

No almacenar el código de examen en texto plano.

`examenes.access_code_hash` contiene una representación segura validada por función del lado servidor; `access_code_lookup` permite localizar el examen sin almacenar el código en texto plano.

## 10. Integridad

Se implementan controles para:

- impedir puntajes negativos;
- validar ventanas de fecha;
- impedir tolerancias negativas;
- impedir evidencia asociada a otro intento;
- impedir respuesta asociada a otro intento;
- impedir modificación de la identidad de un intento;
- evitar posiciones duplicadas de alternativas;
- evitar duplicidad de intentos por número.

## 11. Limitación deliberada de esta etapa

Todavía no se implementan:

- RPC de ingreso del estudiante;
- validación de código de examen;
- creación segura del intento desde usuario anónimo;
- URLs firmadas para evidencias;
- motor de calificación;
- motor de aleatorización.

El esquema queda preparado para esas funciones sin abrir datos sensibles prematuramente.

## 12. Verificación posterior a la instalación

Ejecutar `supabase/sql/verification_queries.sql`. La consulta de privilegios `anon` sobre tablas protegidas debe devolver cero filas.
