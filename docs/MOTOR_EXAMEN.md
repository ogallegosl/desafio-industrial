# Motor de examen — Prompt 08

## Alcance

Esta etapa convierte el intento congelado del Prompt 07 en una evaluación ejecutable por el estudiante. El motor utiliza la Edge Function `exam-access` como única puerta de acceso estudiantil a preguntas, respuestas, navegación y cierre del intento.

## Flujo

```text
Intento preparado
   ↓
Generación congelada de preguntas
   ↓
Inicio del intento
   ↓
Carga del motor
   ↓
Pregunta + respuesta
   ↓
Cola local inmediata
   ↓
Autoguardado en servidor
   ↓
Navegación según reglas
   ↓
Revisión
   ↓
Envío definitivo o cierre por tiempo
```

## Acciones nuevas de `exam-access`

- `engine`: carga preguntas visibles, respuestas guardadas, posición y hora del servidor.
- `save_answer`: guarda una respuesta con control de revisión creciente.
- `navigate`: persiste la posición y aplica reglas de navegación.
- `ping`: sincroniza hora/estado cada 30 segundos.
- `submit`: cierra el intento por envío del estudiante o vencimiento.

Las claves de corrección de `grading_snapshot` nunca se incluyen en la carga del estudiante.

## Cronómetro

El límite real está almacenado en `intentos.deadline_at`.

El frontend recibe `serverNow` y calcula el tiempo restante con una referencia monotónica durante la sesión. Cada heartbeat vuelve a calibrar la referencia. Modificar el reloj visible del navegador no cambia `deadline_at`.

Si el navegador queda sin conexión, el cronómetro local continúa. Al recuperar conexión, el servidor vuelve a ser la fuente de verdad. Si el límite ya pasó, el intento queda `time_expired` y no se aceptan nuevas respuestas.

## Autoguardado

Cada cambio:

1. se escribe inmediatamente en `localStorage`;
2. recibe `client_revision` creciente;
3. se envía después de 700 ms sin nuevos cambios;
4. si llega una revisión anterior a una ya guardada, el servidor la ignora;
5. al confirmar el servidor, la entrada correspondiente se elimina de la cola local.

Esto evita que una respuesta antigua, retrasada por la red, sobrescriba una respuesta más reciente.

## Pérdida temporal de internet

Mientras no exista conexión:

- el estudiante puede seguir respondiendo;
- las respuestas quedan en cola local;
- se conserva un snapshot visible del examen para recuperación local;
- la interfaz indica que existen cambios pendientes;
- al reconectar, las respuestas se sincronizan en orden de revisión;
- la navegación secuencial avanzada offline se reproduce contra el servidor al reconectar.

El envío definitivo requiere conexión, porque el servidor debe cerrar autoritativamente el intento.

## Navegación

### Libre

Se puede ir a cualquier pregunta.

### Secuencial con retroceso

El estudiante puede avanzar solo hasta la siguiente pregunta no alcanzada y regresar a cualquiera ya alcanzada.

### Secuencial sin retroceso

El estudiante solo puede avanzar. El servidor rechaza intentos de volver a posiciones anteriores.

La posición se guarda en:

- `current_question_order`;
- `max_question_order_reached`.

## Tipos de preguntas ejecutables

El motor presenta:

- alternativa única;
- selección múltiple;
- verdadero/falso;
- respuesta corta;
- numérica;
- desarrollo;
- imagen + alternativas;
- imagen + desarrollo;
- cálculo;
- cálculo + evidencia (resultado numérico + fotografía/PDF privado);
- caso práctico con subpreguntas;
- archivo adjunto con almacenamiento privado y URL firmada temporal.

Las imágenes privadas se entregan mediante URLs firmadas temporales generadas en servidor.

## Revisión final

La pantalla de revisión muestra:

- total de preguntas;
- respondidas;
- omitidas;
- mapa de estados;
- cronómetro aún activo;
- advertencia antes del envío.

El envío cambia el intento a `submitted`. Cuando el tiempo vence, cambia a `time_expired` con `submission_reason = TIME_EXPIRED`.

## Migración

`0013_exam_runtime_engine.sql` añade:

- `intentos.current_question_order`;
- `intentos.max_question_order_reached`;
- `intentos.last_server_sync_at`;
- `respuestas.client_revision`;
- índices para respuestas y vencimientos.

## Integración con evidencias

La carga de fotografías y PDF está implementada mediante `student-evidence`, autorizaciones temporales y validación del archivo. `calculation_evidence` exige resultado numérico y evidencia; `attachment` exige archivo. Las subpreguntas dentro de `case_group` no pueden ser de estos dos tipos porque la evidencia se vincula a una pregunta de intento de nivel superior.
