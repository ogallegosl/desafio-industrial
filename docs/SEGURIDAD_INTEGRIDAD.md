# Seguridad y control de integridad — Prompt 14

## Alcance

Auditoría del sistema acumulado después del Prompt 13. Se revisaron autenticación, autorización, RLS, Edge Functions, Storage, exposición de claves, cronómetro, intentos, cargas de archivos, exportaciones y datos temporales del navegador.

## Controles vigentes

### Autenticación docente

- Supabase Auth gestiona la sesión del docente.
- La interfaz exige además un perfil activo con rol `teacher` o `admin`.
- La autorización real se aplica en PostgreSQL mediante RLS; el frontend no es la barrera de seguridad.
- Las funciones `private.owns_course`, `private.owns_exam`, `private.owns_attempt` y `private.current_teacher_id` ahora exigen que la cuenta continúe activa.

### Acceso estudiantil

- El estudiante no recibe acceso directo a las tablas protegidas.
- `exam-access` media el acceso mediante un código de examen y un token aleatorio por intento.
- En PostgreSQL solo se conserva el hash SHA-256 del token de sesión.
- El token del navegador se guarda en `sessionStorage`, no en `localStorage`.
- Las respuestas offline sí se conservan temporalmente en `localStorage` para tolerar interrupciones; se eliminan automáticamente cuando el intento está cerrado.

### Rate limiting

La Edge Function aplica límites antes de procesar operaciones:

- `validate` / `prepare`: límite por red de origen, suficientemente amplio para un aula detrás del mismo NAT.
- acciones de un intento: límite aislado por token de sesión.
- las claves de rate-limit se almacenan como hashes y la tabla no tiene acceso para `anon` ni `authenticated`.

Estos límites reducen fuerza bruta y abuso automatizado; no sustituyen protección de infraestructura contra ataques distribuidos.

### CORS

La función dejó de responder con `Access-Control-Allow-Origin: *`.

En producción debe configurarse el secret/variable:

```text
APP_ALLOWED_ORIGINS=https://tu-sitio.netlify.app,https://tu-dominio.edu.pe
```

Si no se configura, solo se autorizan los orígenes locales de desarrollo declarados en `_shared/cors.ts`.

CORS es una protección del navegador; no autentica clientes no-browser.

### Row Level Security

Las 23 tablas del esquema `public` detectadas por la auditoría tienen RLS habilitado.

También se revocó `CREATE` en el esquema `public` para `PUBLIC`, `anon` y `authenticated`, reduciendo el riesgo de shadowing de objetos en funciones con privilegios elevados.

Las funciones analíticas y de exportación pasaron a `SECURITY INVOKER`, porque el docente ya tiene acceso legítimo a sus datos mediante RLS.

### Storage

Buckets privados:

- `question-media`
- `student-evidence`

`question-media` exige una cuenta docente/administradora activa y una ruta perteneciente al usuario.

`student-evidence` es de solo lectura para docentes autenticados. La escritura y eliminación se realizan mediante la Edge Function con validaciones de intento y pregunta.

### Validación de evidencias

Para JPG/JPEG, PNG, WEBP y PDF se verifican:

1. extensión;
2. MIME declarado;
3. MIME almacenado;
4. tamaño declarado;
5. tamaño real;
6. firma binaria (magic bytes);
7. pertenencia al intento/pregunta;
8. estado `in_progress` del intento.

Un archivo que no coincida con el formato autorizado se elimina del bucket y no se registra como evidencia válida.

### Integridad del examen

- La selección de preguntas se congela al iniciar el intento.
- `grading_snapshot` no se envía en el payload del motor estudiantil.
- El cronómetro usa `deadline_at` persistido en el servidor.
- Las revisiones crecientes (`client_revision`) impiden que una respuesta antigua sobrescriba otra más reciente.
- El cierre por tiempo se valida del lado servidor.
- Las respuestas correctas continúan fuera de las consultas del estudiante.

### XSS y cabeceras HTTP

No se detectó uso de `dangerouslySetInnerHTML`, `eval`, `new Function` ni `document.write` en el frontend.

Netlify incorpora:

- Content-Security-Policy;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- Referrer-Policy;
- Permissions-Policy;
- Cross-Origin-Opener-Policy.

### Exportaciones

Los campos textuales exportados a XLSX/CSV que empiecen con `=`, `+`, `-`, `@`, tabulador o retorno de carro son neutralizados antes de generar el archivo. Esto evita que una respuesta o nombre introducido por un alumno se interprete como fórmula al abrir el archivo en Excel.

### Importación masiva

Además del límite de 1000 filas, el archivo XLS/XLSX/CSV tiene ahora un límite previo de 10 MB para reducir consumo descontrolado de memoria durante el parseo en el navegador.

## Limitaciones y riesgos residuales

Ninguna aplicación web puede impedir completamente:

- fotografías o capturas de pantalla realizadas desde otro dispositivo;
- que un alumno comparta voluntariamente el código del examen;
- suplantación de identidad cuando el examen se configura sin matrícula previa y solo solicita datos declarativos;
- ataques distribuidos desde muchas redes diferentes;
- manipulación de un dispositivo que ya esté totalmente comprometido.

Para evaluaciones de mayor exigencia se recomienda activar `restrict_to_enrolled_students`, solicitar código universitario/correo institucional, usar códigos de examen no triviales y definir una ventana de acceso limitada.

## Configuración obligatoria antes de producción

1. Ejecutar las 19 migraciones o `supabase/sql/bootstrap_all.sql`.
2. Desplegar la Edge Function `exam-access`.
3. Configurar `APP_ALLOWED_ORIGINS` con el dominio real de Netlify y cualquier dominio institucional permitido.
4. Mantener `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY` únicamente en el entorno de Supabase Functions.
5. No crear variables `VITE_*` con secretos privados.
6. Probar RLS con dos docentes diferentes y un usuario desactivado.
7. Ejecutar `npm run audit:security` antes del despliegue final.
