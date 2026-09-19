# Autenticación y acceso — Prompt 03

## 1. Docente

El docente utiliza Supabase Auth con correo y contraseña.

El inicio de sesión solo se considera válido cuando, además del usuario de `auth.users`, existe un registro activo en `public.usuarios` con rol `teacher` o `admin`.

No se habilita registro público de docentes desde la aplicación.

### Alta inicial de un docente

1. Crear el usuario desde **Authentication > Users** en el panel de Supabase.
2. Copiar el UUID asignado.
3. Registrar el perfil autorizado en `public.usuarios` y `public.docentes`.

Ejemplo, reemplazando los valores:

```sql
insert into public.usuarios (
  id, role, first_name, last_name, display_name, email, is_active
)
values (
  'UUID-DE-AUTH-USERS',
  'teacher',
  'Oscar',
  'Gallegos',
  'Oscar Gallegos',
  'docente@universidad.edu.pe',
  true
);

insert into public.docentes (usuario_id, employee_code, institution_name)
values (
  'UUID-DE-AUTH-USERS',
  'DOC-001',
  'Institución universitaria'
);
```

La aplicación no convierte automáticamente una cuenta nueva en docente; esto evita que una eventual habilitación accidental del registro público otorgue privilegios académicos.

## 2. Código del examen

El código nunca se guarda en texto plano.

`public.set_exam_access_code(exam_id, code)` genera:

- `access_code_lookup`: SHA-256 del código normalizado para localizar el examen sin recorrer toda la tabla;
- `access_code_hash`: hash mediante `pgcrypto` para verificar el código.

Los códigos se tratan sin distinción de mayúsculas/minúsculas y se eliminan espacios al inicio y final.

Ejemplo para un docente autenticado:

```js
await supabase.rpc('set_exam_access_code', {
  p_exam_id: examId,
  p_access_code: 'SEG2026',
})
```

## 3. Acceso del estudiante

El estudiante no necesita una cuenta de Supabase Auth.

El navegador llama a la Edge Function `exam-access`, que es el único punto público encargado de:

1. validar el código;
2. comprobar estado y horario;
3. leer los campos de identificación requeridos;
4. comprobar matrícula cuando el examen esté restringido;
5. verificar el máximo de intentos;
6. crear o recuperar el intento;
7. emitir un token temporal de sesión;
8. iniciar el tiempo solo cuando el alumno confirma.

Las tablas de preguntas, intentos, respuestas y evidencias continúan sin acceso directo para `anon`.

## 4. Estados del intento

### `created`

El estudiante fue identificado y el intento quedó preparado. El tiempo aún no comienza.

### `in_progress`

El estudiante confirmó **Iniciar examen**. Se registran `started_at` y `deadline_at`.

### `submitted`

El alumno entregó el examen. El intento queda cerrado, se ejecuta la calificación automática y las respuestas dejan de ser editables.

### `time_expired`

El plazo llegó a cero. El intento se cierra con `submission_reason = TIME_EXPIRED`; el motor mantiene el mismo `deadline_at` y puede consolidar, dentro de una ventana técnica limitada, respuestas locales que ya estaban pendientes antes del vencimiento.

### `cancelled`

Estado reservado para cancelaciones administrativas.

## 5. Reingreso

Si el estudiante vuelve a identificarse y existe un intento `created` o `in_progress`, el backend recupera ese mismo intento y rota el token de sesión.

Por ello:

- actualizar la página no debe crear un intento nuevo;
- cerrar el navegador no concede tiempo adicional;
- volver a ingresar no reinicia el cronómetro de un intento iniciado.

## 6. Token estudiantil

El token crudo solo se entrega al navegador y se conserva en `sessionStorage`.

La base de datos guarda únicamente SHA-256 del token en `student_attempt_sessions`.

La tabla no tiene permisos para `anon` ni `authenticated`; la usa exclusivamente el backend de la Edge Function.

## 7. Restricción por matrícula

`configuraciones_examen.restrict_to_enrolled_students` controla si el examen exige que el estudiante figure en `matriculas` con estado `active`.

- `false`: puede crearse o reutilizarse una identidad estudiantil durante el acceso.
- `true`: solo se acepta una identidad ya matriculada en el curso.

## 8. Variables del frontend

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Para producción se utiliza únicamente `VITE_SUPABASE_PUBLISHABLE_KEY`. Las claves `anon` heredadas no forman parte de la configuración recomendada del proyecto.

## 9. Edge Function

Archivo principal:

```text
supabase/functions/exam-access/index.ts
```

Configuración:

```toml
[functions.exam-access]
verify_jwt = false
```

La función debe estar públicamente invocable porque los estudiantes no tienen una sesión Auth. El código del examen y el token temporal son las credenciales de acceso de este flujo.

## 10. Límites de esta fase

Todavía no se implementa:

- selección aleatoria real de preguntas;
- congelamiento de preguntas al iniciar;
- autoguardado de respuestas;
- cronómetro visual sincronizado;
- envío final;
- evidencias;
- calificación.

No debe utilizarse esta versión parcial para aplicar un examen real hasta completar esas etapas.
