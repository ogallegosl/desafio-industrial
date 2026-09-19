# Monitoreo en vivo — Desafío Industrial v1.2.0

## Acceso docente

En **Panel docente → Exámenes**, los exámenes programados, activos o cerrados muestran la acción **En vivo**. La ruta es:

```text
/docente/examenes/<exam-id>/monitoreo
```

## Información mostrada

El monitor obtiene un resumen seguro mediante `get_exam_live_monitor(uuid)` y muestra:

- participantes únicos;
- intentos rindiendo, preparados, entregados y agotados;
- pregunta actual;
- número de preguntas respondidas;
- tiempo restante;
- ampliaciones de tiempo;
- última actividad;
- última señal del navegador;
- incidencias de integridad;
- matriz de avance P1…Pn.

La matriz **no muestra la respuesta seleccionada ni si es correcta** mientras el examen sigue en curso.

## Actualización

El panel usa Supabase Realtime sobre `intentos`, `logs` y `examenes`. Cada cambio dispara una recarga resumida del monitor. Si Realtime no está disponible, existe un sondeo de respaldo cada 15 segundos.

El alumno ejecuta un heartbeat cada 5 segundos. Esto permite que reciba rápidamente:

- extensiones de tiempo;
- cierre individual;
- cierre global.

## Controles

### Cerrar nuevos ingresos

`set_exam_accept_new_attempts` cambia `accept_new_attempts` sin cerrar intentos preparados o en curso. Un estudiante que todavía no tenía un intento abierto recibirá `EXAM_ADMISSIONS_CLOSED` al intentar ingresar.

### Extender tiempo individual

`teacher_extend_attempt_time` admite de 1 a 120 minutos por operación y actualiza:

- `deadline_at`;
- `offline_recovery_until`;
- `extra_time_seconds`;
- vencimiento de la sesión temporal.

### Extender tiempo global

`teacher_extend_exam_time` amplía los intentos en curso y, si existe, también `ends_at` del examen.

### Finalizar un estudiante

`teacher_force_submit_attempt`:

- envía un intento `in_progress`;
- cancela un intento `created` que aún no empezó;
- registra motivo, docente y hora.

### Finalizar para todos

`teacher_force_close_exam`:

- cambia el examen a `closed`;
- cierra nuevos ingresos;
- envía todos los intentos en curso;
- cancela intentos preparados;
- conserva la calificación automática mediante el trigger existente;
- registra la acción en `logs`.

## Respuestas offline al momento del corte

Si el docente finaliza mientras un alumno está temporalmente sin conexión, las respuestas que ya estaban en la cola local **antes de la hora exacta del corte** pueden consolidarse durante una ventana técnica de 5 minutos. Respuestas con timestamp posterior al corte son rechazadas. Después de recuperar la cola, el sistema recalcula la calificación.

## Migración

La funcionalidad requiere:

```text
0026_live_exam_monitoring.sql
```

La migración también intenta agregar `intentos`, `logs` y `examenes` a la publicación `supabase_realtime` cuando existe.
