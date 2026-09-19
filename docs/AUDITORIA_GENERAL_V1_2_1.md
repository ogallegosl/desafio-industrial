# Auditoría general completa — Desafío Industrial v1.2.1

Fecha de auditoría: 18/09/2026.

## Alcance

Se auditó la plataforma acumulativa completa: acceso de estudiante, motor de examen, seguridad, cámara/evidencias, recuperación offline, calificación automática y manual, rúbricas, resultados, Excel/CSV, PDF individual, configuración global, experiencia móvil, monitoreo docente en vivo, ciclo de vida de exámenes, bancos/preguntas y preparación de despliegue.

## Resultado global

- Suite acumulativa `npm run test:all`: **PASS**.
- Seguridad: **17/17 PASS**.
- Recuperación ante fallas: **23/23 PASS**.
- Auditoría estricta: **26/26 PASS**.
- Examen DEMO: **32/32 PASS**.
- QA general: **PASS** sin fallos críticos/altos.
- Responsive/rendimiento: **PASS**.
- Configuración global: **30/30 PASS**.
- Auditoría final: **43/43 PASS**.
- DEMO local: **21/21 PASS**.
- Mejoras v1.1: **31/31 PASS**.
- Ajustes v1.1.1: **17/17 PASS**.
- Monitoreo v1.2.0: **26/26 PASS**.
- Auditoría docente exhaustiva v1.2.1: **63/63 PASS**.
- Auditoría de paquete: **PASS**.
- Preparación de despliegue: **20/20 PASS**.
- Imports locales verificados: **179**, faltantes: **0**.
- Migraciones: **27**, todas incluidas en `bootstrap_all.sql`.
- Archivos vacíos: **0**.
- Asignaciones de claves secretas encontradas: **0**.

## Hallazgos corregidos durante esta auditoría

### 1. Dashboard docente truncado
La versión 1.2.0 calculaba participantes sobre un máximo de 1000 intentos. Se reemplazó por `get_teacher_dashboard()` en PostgreSQL, con agregación completa y RLS.

### 2. Plan de preguntas editable después de publicar
Ahora `preguntas_examen` y `reglas_seleccion_examen` solo pueden modificarse mientras el examen está en borrador y sin intentos.

### 3. Configuración estructural mutable con historial
Duración, cantidad de preguntas, aleatorización, navegación, identificación del alumno, escala y seguridad quedan congeladas cuando el examen deja de ser borrador o tiene intentos.

### 4. Horarios y ciclo de vida
No se puede reescribir la hora inicial después de registrar intentos ni devolver a borrador un examen con historial. Un examen con intentos abiertos no puede archivarse.

### 5. Eliminación de evidencia académica
Un examen con cualquier intento registrado ya **no puede eliminarse**. Debe archivarse, conservando resultados, PDFs, evidencias y trazabilidad.

### 6. Bancos/preguntas publicados
Se bloqueó archivar un banco que contenga preguntas fijas o candidatas de un examen programado/activo.

### 7. Igualdad entre alumnos
Se congeló el contenido de preguntas y alternativas que formen parte —de manera fija o como candidatas aleatorias— de un examen programado/activo. Así un alumno posterior no recibe una versión modificada respecto de quienes empezaron antes.

### 8. Generador aleatorio
El runtime excluye bancos archivados. El validador de publicación realiza una comprobación conservadora del solapamiento entre reglas para reducir fallos por falta de preguntas únicas.

### 9. Pregunta + alternativas
El guardado del núcleo de la pregunta y sus alternativas se realiza de forma transaccional con `save_question_core()`.

### 10. Panel docente e identidad
Las vistas de evidencia y calificación ya no muestran identificadores técnicos sintéticos generados internamente; trabajan con Apellidos y Nombres e intento.

## Auditoría específica del panel docente

### Autenticación
PASS: Supabase Auth, roles teacher/admin activos, rutas protegidas y cierre de sesión.

### Dashboard
PASS: exámenes activos, próximos, participantes únicos, revisiones pendientes y recientes. Sin límite artificial de 1000 intentos.

### Cursos
PASS: crear, editar, archivar/restaurar. Un curso con exámenes programados/activos no puede archivarse.

### Bancos y preguntas
PASS: crear/editar/duplicar/archivar, filtros, imágenes, 12 tipos, importación Excel/CSV, protección de material publicado y guardado transaccional.

### Exámenes
PASS: crear/editar/duplicar/activar/programar/cerrar/archivar, código de acceso, horarios, intentos, aleatorización, navegación, seguridad y visibilidad de resultados. Se protege el historial.

### Monitoreo en vivo
PASS: Realtime + polling de respaldo, avance, pregunta actual, respondidas, tiempo, incidencias, cierre de ingresos, tiempo extra individual/global y finalización individual/global.

### Evidencias
PASS: vista docente, URL firmada temporal, imagen/PDF, revisión y vínculo con calificación.

### Calificación manual
PASS: cola, rúbricas, puntaje, comentarios, recalificación y cierre de nota final.

### Resultados
PASS: resumen, por pregunta, por estudiante, múltiples intentos, Excel, CSV y PDF individual.

### Configuración
PASS: identidad institucional, logo, escala, nota mínima, zona horaria y reglas de evidencia.

## Seguridad

RLS permanece habilitado en tablas públicas; no existen service-role/secret keys en el frontend; CORS usa allowlist; los buckets sensibles son privados; las claves correctas no se envían al motor del estudiante; se mantiene rate limiting, validación binaria de archivos y protección contra formula injection.

## Limitaciones que NO se consideran validadas todavía

1. **Build Vite real**: `npm install` agotó el tiempo de red en el entorno de auditoría. Por eso `npm run build` devuelve `vite: not found`. No es un fallo de código demostrado; falta instalar dependencias.
2. **E2E real Supabase**: no existe en este entorno una instancia Supabase vinculada, Docker, `psql` ni Supabase CLI. Las 27 migraciones no se ejecutaron contra una base real durante esta auditoría.
3. **Realtime real con varios celulares**: el código y las pruebas estructurales pasan, pero debe validarse con 2–3 alumnos simultáneos después del despliegue.

## Criterio de liberación

La versión 1.2.1 queda **aprobada a nivel de código, simulaciones y auditoría estática**, pero antes de un examen oficial debe superar el checklist E2E de producción descrito en `docs/GUIA_SUBIDA_NUBE_V121.md`.
