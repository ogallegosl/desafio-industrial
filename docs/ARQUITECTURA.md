# Arquitectura del Sistema de Evaluación Virtual

## 1. Objetivo

Construir una plataforma web para diseñar, ejecutar, corregir y analizar evaluaciones universitarias, con énfasis en preguntas visuales, cálculos, evidencias, aleatorización y calificación mixta.

La aplicación se concibe como un sistema modular. La primera etapa define la estructura; las funcionalidades se incorporarán progresivamente sin reconstruir el proyecto.

## 2. Arquitectura general

```text
NAVEGADOR
   |
   | HTTPS
   v
NETLIFY
React + Vite
   |
   | Supabase JS SDK
   v
SUPABASE
   |- Auth
   |- PostgreSQL
   |- Storage
   |- Row Level Security
   `- Funciones/servicios posteriores si fueran necesarios
```

## 3. Capas

### Frontend

Responsable de:

- interfaz;
- navegación;
- validaciones de experiencia de usuario;
- renderizado de preguntas;
- carga de archivos;
- comunicación con Supabase;
- manejo temporal de estado.

No debe contener secretos ni respuestas correctas innecesarias.

### Servicios

`src/services` centraliza la comunicación con Supabase y otras dependencias externas.

### Lógica de negocio

Se distribuirá entre hooks, utilidades y servicios. La lógica sensible debe validarse también del lado del servidor o de la base de datos cuando corresponda.

### Persistencia

Supabase/PostgreSQL almacenará:

- usuarios;
- cursos;
- bancos;
- preguntas;
- exámenes;
- intentos;
- respuestas;
- calificaciones;
- resultados;
- auditoría.

### Archivos

Supabase Storage almacenará:

- imágenes de preguntas;
- evidencias de estudiantes;
- archivos adjuntos.

## 4. Roles

### Docente / administrador

Tendrá autenticación segura y podrá gestionar cursos, bancos, exámenes, resultados y revisión.

### Estudiante

Accederá mediante código de examen y los identificadores que el docente configure.

El modelo está implementado mediante Supabase Auth para docentes y sesiones temporales controladas para estudiantes.

## 5. Módulos

1. Autenticación y roles.
2. Cursos.
3. Bancos de preguntas.
4. Editor de preguntas.
5. Gestión de exámenes.
6. Importación Excel/CSV.
7. Motor de aleatorización.
8. Motor de examen.
9. Cronómetro.
10. Autoguardado.
11. Evidencias.
12. Calificación automática.
13. Calificación manual.
14. Resultados.
15. Analítica.
16. Exportación.
17. Seguridad.
18. Configuración global.
19. Auditoría y logs.

## 6. Flujo docente

```text
Login
  |
Dashboard
  |
Curso
  |
Banco de preguntas
  |
Crear / importar preguntas
  |
Crear examen
  |
Configurar acceso, tiempo y reglas
  |
Seleccionar preguntas
  |
Activar examen
  |
Monitorear participaciones
  |
Revisar pendientes
  |
Publicar nota
  |
Exportar resultados
```

## 7. Flujo estudiante

```text
Código de examen
  |
Validación
  |
Identificación
  |
Reglas e instrucciones
  |
Inicio de intento
  |
Generación/congelamiento de preguntas
  |
Resolución + autoguardado
  |
Carga de evidencias
  |
Revisión
  |
Envío
  |
Confirmación / resultado según configuración
```

## 8. Tipos de preguntas previstos

- single_choice
- multiple_choice
- true_false
- short_text
- numeric
- essay
- image_single_choice
- image_essay
- calculation
- calculation_evidence
- case_group
- attachment

Se utilizarán identificadores estables para evitar romper datos cuando se modifique el texto visible.

## 9. Seguridad

Principios:

- autenticación fuerte para docentes;
- autorización por rol;
- Row Level Security en Supabase;
- no exponer claves privadas;
- no entregar respuestas correctas al alumno antes de tiempo;
- almacenamiento privado de evidencias;
- validación de tipos y tamaños de archivo;
- trazabilidad de intentos;
- control de acceso por examen;
- variables de entorno;
- privilegios mínimos.

La clave `anon` de Supabase puede estar en frontend porque se combina con RLS. Las claves de servicio nunca deben estar en el navegador.

## 10. Estrategia de almacenamiento

### PostgreSQL

Datos estructurados y transaccionales.

### Supabase Storage

Archivos y evidencias.

Buckets previstos:

- `question-media`
- `student-evidence`

Las políticas están implementadas mediante RLS y buckets privados; las evidencias estudiantiles se escriben a través de la Edge Function y autorizaciones temporales.

## 11. Estado del examen

Los intentos deberán registrar un estado inequívoco, por ejemplo:

- CREATED
- IN_PROGRESS
- SUBMITTED
- TIME_EXPIRED
- CANCELLED

El estado será persistente.

## 12. Tiempo

El cronómetro definitivo no confiará exclusivamente en el navegador. Se basará en la hora de inicio persistida y una referencia de servidor.

## 13. Aleatorización

Cada alumno podrá recibir una selección diferente.

Una vez creado el intento:

- se seleccionan las preguntas;
- se registra su orden;
- se registra el orden de alternativas;
- la selección queda congelada.

Actualizar la página no generará un nuevo examen.

## 14. Autoguardado

Cada respuesta se persistirá durante el intento.

Se añadirá almacenamiento temporal local para tolerar caídas breves de conectividad. La base de datos continuará siendo la fuente de verdad.

## 15. Escalabilidad

La estructura admite inicialmente una sola institución, pero deja abierta la posibilidad de soportar varias mediante configuración futura.

## 16. Estructura de carpetas

```text
/src
  /components
  /pages
  /layouts
  /services
  /hooks
  /utils
  /styles
  /assets
  /contexts

/supabase
  /migrations
  /sql

/public
/docs
```

## 17. Criterio de evolución

Cada fase debe:

1. conservar las funcionalidades existentes;
2. modificar solamente los módulos necesarios;
3. validar regresiones;
4. documentar cambios;
5. mantener compatibilidad con Netlify y Supabase.
