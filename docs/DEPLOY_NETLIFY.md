# Despliegue de Desafío Industrial v1.3.0 — Supabase + Netlify

Esta guía corresponde al Prompt 19 y deja la plataforma preparada para un despliegue reproducible. No contiene credenciales reales.

## 0. Requisitos

- Node.js 22.12 o superior dentro de la rama 22.x. El repositorio incluye `.node-version` con `22`.
- npm.
- Git y un repositorio GitHub para despliegue continuo (recomendado).
- Supabase CLI para migraciones y Edge Functions.
- Cuenta en Supabase.
- Cuenta en Netlify.

Antes de publicar:

```bash
npm install
npm run test:all
npm run deploy:check
```

El proyecto usa Vite 7, por lo que no debe compilarse con Node 18.

---

## 1. Crear el proyecto Supabase

1. Inicia sesión en Supabase.
2. Crea un proyecto nuevo.
3. Guarda de forma segura la contraseña de la base de datos.
4. Obtén el **Project Ref** desde la URL del Dashboard o desde el diálogo **Connect**.
5. No copies ninguna `secret key` o `service_role` al frontend.

Desafío Industrial utilizará únicamente:

```env
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

La publishable key puede estar en el navegador; la protección de datos depende de RLS, grants y autenticación. Las claves secretas quedan exclusivamente en servicios controlados por el servidor.

---

## 2. Vincular el proyecto local y aplicar las 27 migraciones

Instala e inicia sesión con Supabase CLI y vincula el proyecto:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
```

Comprueba el historial antes de aplicar cambios:

```bash
supabase migration list
supabase db push --dry-run
```

Si el proyecto Supabase es nuevo y no contiene cambios manuales, aplica las migraciones:

```bash
supabase db push
```

Las migraciones se encuentran en:

```text
supabase/migrations/
```

Actualmente son 27, desde `0001_extensions_enums.sql` hasta `0027_teacher_audit_hardening.sql`.

### Alternativa para una base completamente nueva

El archivo:

```text
supabase/sql/bootstrap_all.sql
```

contiene las mismas migraciones en secuencia. Se conserva como recurso de recuperación/inspección, pero el flujo recomendado de producción es **Supabase CLI + `db push`**, para mantener el historial de migraciones sincronizado.

No hagas cambios de esquema manuales en producción después de adoptar el flujo de migraciones.

---

## 3. Verificar Storage

La migración `0007_storage.sql` crea automáticamente los buckets privados:

```text
question-media
student-evidence
```

Después de `supabase db push`, verifica en **Storage** que ambos existan y permanezcan privados.

No conviertas estos buckets en públicos. Las imágenes de preguntas y evidencias usan políticas RLS/Storage y URLs firmadas temporales.

---

## 4. Obtener URL y publishable key

En Supabase abre **Connect** o **Settings → API Keys** y copia:

- Project URL;
- Publishable key `sb_publishable_...`.

No utilices una `secret key` en Netlify como variable con prefijo `VITE_`.

El cliente de EvaluaLab ya está configurado para leer exclusivamente:

```env
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

---

## 5. Configurar la Edge Function

### 5.1 CORS de producción

La función pública `exam-access` necesita conocer los orígenes web autorizados. Cuando conozcas la URL definitiva de Netlify, configura:

```bash
supabase secrets set APP_ALLOWED_ORIGINS=https://TU-SITIO.netlify.app
```

Para autorizar también un dominio institucional:

```bash
supabase secrets set APP_ALLOWED_ORIGINS=https://TU-SITIO.netlify.app,https://evaluaciones.tuuniversidad.edu.pe
```

Usa orígenes exactos, sin `/` final.

Para desarrollo contra el Supabase remoto, puedes añadir temporalmente:

```text
http://localhost:5173
```

No uses `*` como origen.

### 5.2 Desplegar la función

```bash
supabase functions deploy exam-access
```

`supabase/config.toml` mantiene:

```toml
[functions.exam-access]
verify_jwt = false
```

Esto es deliberado: los estudiantes no necesitan una cuenta Supabase. La función aplica su propio código de examen, token de intento, rate limiting y validaciones.

### 5.3 Confirmar secretos

```bash
supabase secrets list
```

`APP_ALLOWED_ORIGINS` debe aparecer. Las credenciales internas de Supabase se gestionan en el runtime de Edge Functions; no deben copiarse al repositorio.

---

## 6. Configurar Supabase Auth

En **Authentication → URL Configuration**:

1. `Site URL`: usa la URL oficial de producción, por ejemplo:

```text
https://TU-SITIO.netlify.app
```

2. Para desarrollo agrega, si lo necesitas:

```text
http://localhost:5173/**
```

3. Si utilizas Deploy Previews de Netlify y autenticación basada en enlaces/OAuth, agrega un patrón de preview siguiendo la documentación oficial de Supabase, por ejemplo para tu propio sitio:

```text
https://**--TU-SITIO.netlify.app/**
```

Para producción utiliza siempre la URL exacta como Site URL.

---

## 7. Crear el primer docente

Desafío Industrial no permite auto-registro público de docentes.

1. En Supabase abre **Authentication → Users**.
2. Crea el usuario docente con correo y contraseña.
3. Copia su UUID.
4. Ejecuta, sustituyendo los valores:

```sql
insert into public.usuarios (
  id, role, first_name, last_name, display_name, email, is_active
)
values (
  'UUID-DE-AUTH-USERS',
  'teacher',
  'Nombre',
  'Apellido',
  'Nombre Apellido',
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

No asignes `admin` salvo que realmente necesites ese rol.

---

## 8. Preparar GitHub

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Prepare Desafio Industrial production deployment"
```

Crea un repositorio privado o público en GitHub y conecta el remoto siguiendo las instrucciones de GitHub.

Antes del `push`, confirma:

```bash
git status
```

No deben aparecer `.env`, claves secretas ni credenciales.

El repositorio sí debe incluir:

```text
.env.example
.node-version
netlify.toml
supabase/config.toml
supabase/migrations/
supabase/functions/
```

---

## 9. Crear el sitio en Netlify

### Opción recomendada: GitHub

1. En Netlify elige **Add new project / Import an existing project**.
2. Conecta GitHub y selecciona el repositorio.
3. Netlify leerá `netlify.toml`.
4. Verifica:

```text
Build command: npm run build:netlify
Publish directory: dist
Node: 22
```

La regla SPA ya está configurada para que rutas como `/docente/login` o `/acceso` no produzcan 404 al refrescar.

### Variables de entorno en Netlify

En **Project configuration → Environment variables** agrega:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Usa la Project URL y la publishable key obtenidas de Supabase.

No agregues `SUPABASE_SECRET_KEY`, `SUPABASE_SECRET_KEYS`, `service_role` ni contraseñas con prefijo `VITE_`.

El comando `npm run build:netlify` falla deliberadamente si faltan las dos variables públicas necesarias o si la publishable key conserva el placeholder.

---

## 10. Dominio definitivo y CORS

Después del primer deploy Netlify asignará una URL. Si cambias el nombre del sitio o conectas un dominio propio, actualiza **los dos lugares**:

1. Supabase Edge Function:

```bash
supabase secrets set APP_ALLOWED_ORIGINS=https://NUEVO-DOMINIO
```

2. Supabase Auth → URL Configuration → Site URL / Redirect URLs.

Si utilizas un dominio Supabase personalizado distinto de `*.supabase.co`, revisa también la CSP de `netlify.toml`, porque actualmente `connect-src`, `img-src` y `frame-src` autorizan los dominios estándar de Supabase.

---

## 11. Pruebas posteriores al despliegue

Realiza estas pruebas en producción, en este orden:

### Docente

1. Abre `/docente/login`.
2. Inicia sesión.
3. Crea un curso.
4. Crea o usa el examen `[DEMO] Ingeniería de Seguridad`.
5. Comprueba banco de preguntas, imágenes, configuración y resultados.

### Estudiante

1. Abre `/acceso` en una ventana incógnita.
2. Introduce código e identidad.
3. Inicia el examen.
4. Responde preguntas.
5. Recarga la página y confirma que no cambia el cronómetro ni las preguntas.
6. Sube una imagen o PDF de evidencia.
7. Entrega el examen.

### Docente después de la entrega

1. Verifica el intento.
2. Revisa evidencia.
3. Califica una respuesta manual.
4. Verifica nota final.
5. Exporta Excel y CSV.

### Seguridad mínima

- no debe aparecer ninguna secret key en el bundle o DevTools;
- el bucket `student-evidence` debe seguir privado;
- un alumno no debe poder consultar claves correctas antes del cierre general;
- una URL firmada de evidencia debe expirar;
- un origen no incluido en `APP_ALLOWED_ORIGINS` debe ser rechazado por `exam-access`.

---

## 12. Comandos de verificación

### Antes del deploy

```bash
npm run deploy:check
npm run test:all
```

### Simular la validación de variables del build

Con variables reales cargadas en el entorno:

```bash
node scripts/deploy-readiness.mjs --require-env
```

### Build local

```bash
npm run build
```

### Build equivalente a Netlify

```bash
npm run build:netlify
```

---

## 13. Errores frecuentes

### `SUPABASE_NOT_CONFIGURED`

Faltan `VITE_SUPABASE_URL` o `VITE_SUPABASE_PUBLISHABLE_KEY` en Netlify. Añádelas y ejecuta un nuevo deploy.

### `ORIGIN_NOT_ALLOWED`

La URL desde la que estás usando la aplicación no coincide con `APP_ALLOWED_ORIGINS`. Actualiza el secreto y vuelve a probar. No es necesario redesplegar la función únicamente por cambiar secretos.

### Login correcto pero vuelve a `/docente/login`

El usuario existe en `auth.users`, pero puede faltar su perfil activo en `public.usuarios`/`public.docentes`.

### 404 al refrescar una ruta

Confirma que Netlify está leyendo `netlify.toml` y que existe el rewrite `/* → /index.html` con estado 200.

### `db push` informa migraciones fuera de sincronía

No apliques cambios a ciegas. Ejecuta:

```bash
supabase migration list
```

Si el remoto fue modificado manualmente, reconcilia el historial antes de continuar.

---

## 14. Fuentes oficiales consultadas para esta configuración

- Netlify — Vite: https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/
- Netlify — variables de entorno: https://docs.netlify.com/build/configure-builds/environment-variables/
- Netlify — dependencias/Node: https://docs.netlify.com/build/configure-builds/manage-dependencies/
- Supabase — API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase — migraciones: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase — Edge Functions: https://supabase.com/docs/guides/functions/deploy
- Supabase — secrets de Functions: https://supabase.com/docs/guides/functions/secrets
- Supabase — Auth redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
