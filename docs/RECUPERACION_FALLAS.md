# Recuperación ante fallas — Prompt 15

## Objetivo

Evitar que fallas comunes durante una evaluación alteren el intento, reinicien el tiempo, cambien las preguntas asignadas, creen intentos duplicados o borren respuestas ya conservadas.

## 1. Actualización de página

La sesión activa del alumno permanece en `sessionStorage` durante una recarga de la misma pestaña. Al volver a cargar:

- se consulta nuevamente el intento al servidor;
- se conserva el mismo `attempt_id`;
- se conserva el mismo `started_at` y `deadline_at`;
- se cargan las mismas filas de `intento_preguntas` ya congeladas;
- las respuestas pendientes de sincronización se mezclan desde `localStorage` sin reemplazar respuestas más recientes del servidor.

Una actualización de la página no reinicia el cronómetro.

## 2. Cierre del navegador o pestaña y reingreso

Por seguridad, el token temporal del alumno no se almacena de forma persistente en `localStorage`. Si el navegador o la pestaña se cierran, el estudiante debe volver a ingresar:

1. código del examen;
2. identificación requerida.

El servidor busca primero un intento con estado `created` o `in_progress`. Si existe, lo reutiliza y genera un nuevo token temporal para el mismo intento.

Se agregó un marcador local no sensible que avisa al alumno que existe un intento previo. Ese marcador no contiene contraseña ni token de sesión.

## 3. Internet inestable

Cada respuesta se escribe primero en una cola local identificada por `attempt_id` y `attempt_question_id`. Cada versión lleva un `clientRevision` creciente.

Cuando vuelve internet:

- se envían las respuestas pendientes;
- una revisión antigua no puede sobrescribir una más nueva;
- se recupera la posición de navegación admitida por la configuración del examen;
- el tiempo continúa usando `deadline_at` del servidor.

## 4. Pérdida de conexión al vencer el tiempo

Se corrigió un caso límite de la versión anterior: si el alumno permanecía offline hasta el vencimiento, el servidor podía cerrar el intento antes de recibir las últimas respuestas presentes en la cola local.

Ahora existe una ventana técnica de recuperación de **5 minutos** después del `deadline_at`.

Esta ventana:

- no reabre el examen;
- no modifica `deadline_at`;
- no permite seguir navegando ni responder nuevas preguntas en la interfaz;
- solo acepta entradas que ya se encontraban en la cola local y cuyo `queuedAt` es anterior al vencimiento;
- mantiene la protección por `clientRevision`;
- registra el evento `ANSWER_RECOVERED_OFFLINE`;
- registra un resumen `OFFLINE_RECOVERY_COMPLETED`;
- vuelve a ejecutar la calificación automática de forma determinista después de recuperar respuestas.

La medida equilibra continuidad operativa y control del tiempo. El navegador del alumno no es un entorno confiable, por lo que no puede demostrarse criptográficamente que un dato generado offline se creó exactamente antes del vencimiento. Por esa razón la recuperación es breve, queda auditada y no se usa para archivos o navegación.

## 5. Doble clic

Se añadieron bloqueos inmediatos mediante `useRef`, además de los estados visuales existentes, en:

- validación del código;
- preparación del intento;
- inicio del examen;
- envío definitivo;
- subida de evidencia;
- eliminación de evidencia.

En el servidor permanecen las protecciones de idempotencia:

- un intento abierto por estudiante/examen;
- `generate_attempt_questions()` congela preguntas una sola vez;
- `startAttempt()` reutiliza un intento que ya está `in_progress`;
- el envío definitivo tolera reintentos;
- `client_revision` protege respuestas frente a llegadas fuera de orden.

## 6. Fallo durante una carga de evidencia

La evidencia anterior no se marca como reemplazada hasta que la nueva evidencia:

1. llega a Storage;
2. pasa validación de tamaño, MIME, extensión y firma binaria;
3. queda registrada en PostgreSQL;
4. queda asociada correctamente a la respuesta.

Si falla alguno de esos pasos, se conserva la evidencia anterior.

La confirmación de una carga es ahora idempotente. Si el servidor completó el registro pero la respuesta HTTP se perdió, un reintento puede recuperar la evidencia ya registrada mediante el `uploadId`.

## 7. Expiración o invalidación de sesión

Si una sesión temporal se invalida:

- no se eliminan las respuestas locales;
- se elimina únicamente el token temporal inválido;
- el alumno vuelve a `/acceso` con un aviso de recuperación;
- al ingresar de nuevo el código y su identidad, el servidor recupera el mismo intento abierto.

## 8. Intentos duplicados

La base incorpora un índice único parcial:

```sql
unique (exam_id, student_id)
where status in ('created', 'in_progress')
```

Esto complementa la restricción histórica `(exam_id, student_id, attempt_number)` y evita dos intentos abiertos simultáneos para la misma evaluación y estudiante.

## 9. Datos locales al finalizar

La pantalla final ya no elimina automáticamente la cola local solo porque el intento aparezca cerrado.

Si existen respuestas locales pendientes tras un vencimiento:

- intenta consolidarlas automáticamente;
- ofrece un botón de reintento;
- bloquea la salida mientras quede información pendiente;
- conserva los datos locales si la recuperación falla.

Cuando la cola queda vacía, se elimina el snapshot local y el alumno puede salir normalmente.

## 10. Migración incorporada

`0020_failure_recovery.sql` agrega:

- `offline_recovery_until`;
- `offline_recovery_completed_at`;
- `offline_recovery_count`;
- índice único de intento abierto;
- índice de ventana de recuperación;
- RPC de servicio `regrade_attempt_after_offline_recovery(uuid)`.

## 11. Prueba incluida

Ejecutar:

```bash
npm run test:recovery
```

La simulación comprueba actualización, reingreso, red inestable, doble clic, congelamiento de preguntas, fallo de archivos, sesión perdida y recuperación post-vencimiento.
