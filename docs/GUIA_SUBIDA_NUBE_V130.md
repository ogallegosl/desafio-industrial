# Guía de subida a la nube — Desafío Industrial v1.3.0

Objetivo: publicar la aplicación con **Supabase** (base de datos, Auth, Storage, Edge Function y Realtime) y **Netlify** (frontend React/Vite).

## A. Preparar la carpeta en Windows

Abre CMD dentro de la carpeta que contiene `package.json`.

```cmd
node -v
npm -v
npm install
npm run test:all
npm run audit:teacher
npm run audit:v130
npm run audit:package
npm run deploy:check
```

Node debe ser 22.12 o superior.

## B. Crear proyecto Supabase

1. Crea un proyecto nuevo en Supabase.
2. Conserva la contraseña de la base de datos.
3. Copia el **Project Ref**, la **Project URL** y la **Publishable key** `sb_publishable_...`.
4. No uses una secret key en el frontend.

## C. Instalar Supabase CLI en este proyecto

En CMD:

```cmd
npm install supabase --save-dev
npx supabase --help
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
```

La carpeta `supabase/` ya existe, por lo que no debes reemplazarla con un `supabase init` nuevo.

## D. Revisar y aplicar las 27 migraciones

Primero:

```cmd
npx supabase migration list
npx supabase db push --dry-run
```

Si el proyecto remoto es nuevo y el dry-run es coherente:

```cmd
npx supabase db push
```

Debe llegar hasta:

```text
0027_teacher_audit_hardening.sql
```

## E. Verificar Storage y Realtime

En Supabase Dashboard verifica los buckets creados por las migraciones. Los buckets de preguntas/evidencias deben conservar la privacidad definida por las políticas.

Para Realtime, comprueba que las tablas usadas por el monitor estén en la publicación `supabase_realtime`; la migración 0026 lo configura. Si el panel en vivo no recibe eventos, revisa primero publicación y RLS.

## F. Configurar CORS de la Edge Function

Al principio puedes usar temporalmente tu URL local más la futura URL de Netlify:

```cmd
npx supabase secrets set APP_ALLOWED_ORIGINS=http://localhost:5173,https://TU-SITIO.netlify.app
```

No utilices `*`.

## G. Desplegar Edge Function

```cmd
npx supabase functions deploy exam-access
```

La función mantiene `verify_jwt = false` porque el alumno no crea una cuenta Supabase; su acceso se controla con código de examen, token temporal, validaciones y rate limiting.

## H. Crear el primer docente

1. Supabase Dashboard → Authentication → Users → crea el usuario.
2. Copia su UUID.
3. En SQL Editor ejecuta los INSERT indicados en `docs/DEPLOY_NETLIFY.md`, sustituyendo UUID, nombre, correo y código docente.
4. Inicia sesión localmente en `/docente/login` y comprueba el panel.

## I. Crear `.env` local para la prueba real

Copia `.env.example` como `.env` y coloca:

```env
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE
```

Después:

```cmd
npm run dev
```

Prueba docente + alumno en incógnito.

## J. Prueba E2E obligatoria antes de Netlify

Usa tres ventanas/dispositivos: docente, alumno A y alumno B.

1. Crea un curso.
2. Crea banco y varias preguntas.
3. Crea un examen de prueba y publícalo.
4. Los alumnos ingresan con nombres distintos.
5. Verifica en **En vivo** que aparecen casi inmediatamente.
6. Responde y comprueba avance.
7. Cambia de pestaña y comprueba incidencias.
8. Agrega +5 min a un alumno.
9. Cierra nuevos ingresos.
10. Finaliza un intento individual.
11. Finaliza el examen para todos.
12. Revisa evidencias y calificación manual.
13. Descarga PDF individual, Excel y CSV.
14. Confirma que un examen con intentos no pueda eliminarse y solo pueda archivarse.

No uses la plataforma en una evaluación oficial hasta completar esta prueba.

## K. Prueba del importador v1.3.0

Antes de subir a producción, entra como docente a **Exámenes → Importar examen** y utiliza `public/templates/ejemplo_paquete_examen_imagenes.zip`. Comprueba que:

1. la validación reconozca curso, banco, 5 filas y 2 imágenes;
2. el plan resulte en 4 preguntas (3 fijas + 1 aleatoria);
3. el examen se cree en Borrador;
4. ambas imágenes puedan visualizarse desde el editor/vista previa;
5. volver a cargar exactamente el mismo ZIP sea bloqueado como paquete ya importado.

## L. Subir código a GitHub

```cmd
git init
git add .
git commit -m "Desafio Industrial v1.3.0"
```

Crea un repositorio en GitHub y sigue los comandos que GitHub muestre para `remote add` y `push`.

Confirma que `.env` no se haya añadido; `.gitignore` ya debe excluirlo.

## M. Crear sitio en Netlify

1. Netlify → **Add new project / Import an existing project**.
2. Conecta GitHub.
3. Selecciona el repositorio.
4. `netlify.toml` ya configura el proyecto.
5. Verifica:

```text
Build command: npm run build:netlify
Publish directory: dist
Node: 22
```

## N. Variables de entorno en Netlify

Project configuration → Environment variables:

```text
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

No coloques una secret key con prefijo `VITE_`.

## O. Actualizar el origen permitido después del primer deploy

Cuando Netlify te entregue la URL definitiva:

```cmd
npx supabase secrets set APP_ALLOWED_ORIGINS=https://TU-SITIO.netlify.app
```

Si conservas pruebas locales:

```cmd
npx supabase secrets set APP_ALLOWED_ORIGINS=http://localhost:5173,https://TU-SITIO.netlify.app
```

## P. Configurar Auth URL

En Supabase → Authentication → URL Configuration:

- Site URL: `https://TU-SITIO.netlify.app`
- agrega localhost como redirect solo para desarrollo si lo necesitas.

## Q. Prueba final en producción

Repite la prueba E2E con al menos dos celulares reales y un equipo docente. Comprueba especialmente cámara, Wake Lock, pantalla completa, Realtime, cierre remoto, carga de evidencia, PDF, Excel/CSV y recuperación ante una caída breve de internet.

## R. Recomendación de operación

Para el primer examen real, empieza con una práctica de 10–15 alumnos. Después realiza una evaluación completa. Conserva siempre el ZIP de la versión desplegada y no edites preguntas de un examen publicado; v1.3.0 ya lo bloquea para proteger la igualdad entre alumnos.
