# Changelog

## 1.3.0 — Importación automatizada de exámenes completos

- nuevo botón **Exámenes → Importar examen**;
- plantilla XLSX con hojas `Configuracion`, `Preguntas`, `Reglas` e `Instrucciones`;
- soporte de paquete ZIP con un Excel y hasta 500 imágenes JPG/JPEG/PNG/WEBP;
- asociación automática de fotografías por nombre o ruta indicada en la columna `Imagen`;
- creación o reutilización automática del curso por `Curso_Codigo`;
- creación o reutilización de uno o varios bancos del mismo curso;
- reutilización segura de preguntas por `ID` cuando el contenido coincide; los conflictos de contenido se bloquean antes de importar;
- importación de preguntas fijas y reglas de selección aleatoria;
- validación de `Numero_Preguntas` contra fijas + aleatorias y control conservador de candidatas;
- detección de posiciones fijas duplicadas, imágenes faltantes, bancos/cursos archivados y colisiones de código de curso;
- protección contra reimportación del mismo paquete mediante huella SHA-256;
- validación de rutas ZIP, límites de tamaño y firma binaria real de las imágenes;
- marca de trazabilidad almacenada en `configuraciones_examen.settings.import` y preservada por el editor;
- el importador nunca publica automáticamente: todo examen queda en **Borrador**;
- nueva auditoría `npm run audit:v130`: **25/25 PASS**;
- suite acumulativa `npm run test:all`, auditoría docente 63/63, paquete y deploy readiness reejecutados en PASS.

## 1.2.1 — Auditoría general y endurecimiento docente

- Auditoría exhaustiva del panel docente: 63/63 controles PASS.
- Dashboard agregado en PostgreSQL sin truncamiento de 1000 intentos.
- Plan de preguntas y configuración estructural congelados al publicar o cuando existen intentos.
- Protección de horario, ciclo de vida y evidencia histórica del examen.
- Un examen con intentos ya no puede eliminarse: debe archivarse.
- Bancos, preguntas y alternativas usados por exámenes programados/activos quedan protegidos contra cambios que alteren la igualdad entre estudiantes.
- Preguntas y alternativas se guardan de forma transaccional.
- Generador de intentos excluye bancos archivados y el validador de publicación comprueba disponibilidad segura entre reglas aleatorias.
- Panel docente corregido para mostrar solo Apellidos y Nombres, sin identificadores técnicos sintéticos.
- Auditoría de paquete y despliegue actualizadas a 27 migraciones.

## 1.2.0 — Monitoreo docente en vivo y control de examen

- nuevo módulo **Exámenes → En vivo** con actualización mediante Supabase Realtime y sondeo de respaldo;
- panel con participantes, estudiantes rindiendo, entregados e incidencias de integridad;
- seguimiento por estudiante de pregunta actual, avance, tiempo restante, conexión, última actividad e incidencias;
- matriz P1…Pn que muestra respondida/actual/pendiente sin exponer contenido ni corrección;
- control **Cerrar nuevos ingresos** sin interrumpir a quienes ya comenzaron;
- extensiones de +5/+10 minutos por estudiante y para todos los intentos en curso;
- finalización individual de intento y finalización global del examen;
- finalización global envía intentos en curso, cancela preparados y cierra nuevos ingresos;
- heartbeat estudiantil reducido a 5 s para recibir extensiones y cierres con baja latencia;
- recuperación auditada de respuestas offline que ya estaban en cola antes de un cierre forzado por docente;
- mensaje específico **Finalizado por docente** en la pantalla final;
- nueva migración `0026_live_exam_monitoring.sql`;
- auditoría específica `npm run audit:v120` con 26/26 controles PASS;
- suite acumulativa completa reejecutada en PASS.

## 1.1.1 — Ajustes visuales, integridad persistente y auditoría móvil

- corregida la superposición del título de portada con la imagen mediante una composición de tres líneas y columnas con límites explícitos;
- reemplazada la imagen principal por la segunda propuesta visual desarrollada, recortada y optimizada para el hero;
- nuevos fondos discretos en acceso e instrucciones con acentos azul, granate y dorado vinculados a la identidad de Ingeniería Industrial UNSA;
- contador de integridad persistente entre examen, revisión y recargas;
- la Edge Function devuelve el número real de incidencias guardadas en `logs`;
- el DEMO local conserva también el contador de incidencias;
- un cambio de pestaña/aplicación se registra como una sola interrupción de visibilidad en lugar de duplicar salida y retorno;
- en móviles se omite el evento `blur` como fuente de incidencia para reducir falsos positivos por teclado, permisos y UI del sistema;
- incorporado Screen Wake Lock para intentar mantener la pantalla del celular encendida durante el examen;
- evitado el doble conteo por salida de fullscreen mientras la página ya está oculta;
- añadida recomendación explícita para aumentar temporalmente el bloqueo automático de pantalla cuando Wake Lock no esté disponible;
- auditoría visual específica en 320, 360, 390, 430, 768 y 1366 px con 63/63 controles PASS;
- auditoría funcional v1.1.1 con 17/17 controles PASS;
- suite acumulativa completa reejecutada en PASS.

## 1.1.0 — Desafío Industrial, seguridad y reportes PDF

- marca principal renovada a **Desafío Industrial** con identidad visual de Ingeniería Industrial UNSA;
- nueva portada con el mensaje **Evaluación universitaria flexible** e imagen industrial;
- acceso del estudiante simplificado a **Apellidos** y **Nombres**;
- modo de seguridad con pantalla completa, detección de cambios de pestaña/foco, bloqueo de copiar/pegar/cortar, clic derecho, atajos sensibles e impresión;
- marca de agua con nombre del estudiante y registro de incidencias por intento;
- detección best-effort de pantalla extendida y opción para exigir Safe Exam Browser;
- navegación segura por defecto para nuevos exámenes: secuencial y sin retroceso;
- cámara real mediante `getUserMedia`, con fallback al selector de archivo cuando no existe cámara o se deniega permiso;
- compresión automática de fotografías a aproximadamente 650 KB y límite de evidencia predeterminado de 5 MB;
- optimización del envío DEMO para evitar bloqueos del navegador al consolidar respuestas;
- PDFs individuales descargables por el estudiante y por el docente para cada intento cerrado;
- incidencias de integridad visibles en resultados y exportables;
- nueva migración `0025_desafio_industrial_security_reports.sql`;
- auditoría específica `npm run audit:v110` con 31/31 controles PASS.

## 1.0.1 — Modo DEMO local

- Código `DEMO2026` para probar el flujo estudiantil sin Supabase.
- 15 preguntas DEMO de Ingeniería de Seguridad con alternativas, V/F, numéricas, desarrollo, imagen, cálculo, caso y evidencias.
- Cronómetro, autoguardado, navegación, revisión y envío persistidos localmente en el navegador.
- Resultado provisional con corrección automática de preguntas objetivas.
- Acceso visible **Probar DEMO local** en la pantalla del estudiante.
- Carga de evidencia simulada localmente, sin enviar archivos a internet.

## 1.0.0 — 2026-09-17

### Prompt 22 — Empaquetado final

- consolidada la versión final de EvaluaLab;
- versión de paquete actualizada a 1.0.0;
- añadidas guías operativas para docente y estudiante;
- añadido checklist de liberación final;
- añadido `npm run audit:package` para verificar estructura, 24 migraciones, archivos obligatorios, archivos vacíos y variables públicas;
- eliminados del paquete de distribución inventarios, harnesses, capturas y validaciones intermedias que no son necesarias para operar o desplegar;
- README actualizado para reflejar estado final y verificaciones externas pendientes;
- mantenidos informes QA, seguridad, despliegue y auditoría final como evidencia técnica.

## 0.21.0 — 2026-09-17

### Prompt 21 — Auditoría final integral

- creación y edición de exámenes convertidas en operaciones transaccionales de PostgreSQL;
- exigido al menos un identificador estable del estudiante: código universitario o correo;
- bloqueado el cambio de curso cuando el examen ya tiene preguntas, reglas de selección o intentos;
- editor docente refleja el bloqueo de curso para evitar inconsistencias;
- límites del código de acceso alineados entre interfaz y servidor;
- modales con trampa de foco, restauración de foco y cierre por Escape;
- enlaces para saltar al contenido principal en layouts;
- progreso del examen expuesto como `progressbar` semántico;
- pregunta actual expuesta con `aria-current`;
- tabs de resultados y controles de respuestas correctas reforzados con ARIA;
- foco visible global y mejora de contraste en texto secundario;
- `bootstrap_all.sql` regenerado con 24 migraciones;
- auditoría final automatizada `npm run audit:final21`;
- suite completa, sintaxis y responsive revalidados después de las correcciones.

## 0.20.0 — 2026-09-17

### Prompt 20 — Configuración global

- añadido registro persistente `configuracion_global` con RLS y validaciones de servidor;
- identidad institucional, nombre de plataforma, subtítulo y logotipo configurables;
- nuevo bucket público `branding` con escritura restringida a docentes/administradores activos;
- escala máxima y nota aprobatoria globales usadas como valores predeterminados en nuevos exámenes;
- zona horaria IANA y formato de fecha centralizados;
- editor de exámenes convierte horarios desde la zona configurada a UTC;
- tipos y tamaño máximo de evidencia configurables entre 1 y 50 MB;
- límites de evidencia sincronizados automáticamente con `student-evidence`;
- frontend y Edge Function comparten la misma autoridad de configuración para evidencias;
- branding global aplicado a pantallas públicas y paneles;
- corregida pérdida de cambios no guardados durante operaciones de logotipo;
- selector móvil de evidencias corregido y verificado en 360, 390, 430, 768 y 1366 px;
- añadida migración `0023_global_settings.sql` y auditoría `test:settings20`.

## 0.19.0 — 2026-09-17

### Prompt 19 — Preparación Netlify + Supabase

- creado `.env.example` faltante y plantilla de variables para Edge Functions;
- frontend migrado a `VITE_SUPABASE_PUBLISHABLE_KEY` sin fallback a `anon`;
- Node 22 fijado para Vite 7/Netlify;
- dependencias fijadas a versiones exactas para builds reproducibles;
- añadido `npm run deploy:check` y `npm run build:netlify`;
- build Netlify bloquea despliegues sin URL/publishable key válidas;
- cache de assets hash e `index.html` revalidable;
- guía completa `docs/DEPLOY_NETLIFY.md`;
- preparación documentada de migraciones, Storage, Edge Function, Auth, primer docente, GitHub, Netlify y pruebas post-deploy.

## 0.18.0 — 2026-09-17

### Prompt 18 — Optimización responsive y rendimiento

- carga diferida por ruta mediante `React.lazy` y `Suspense`;
- separación de chunks `react-vendor` y `supabase-vendor`;
- `xlsx` permanece bajo importación dinámica;
- consultas de gestión de cursos/exámenes reducidas a columnas necesarias;
- imágenes administrativas con `loading=lazy`/`decoding=async`;
- imágenes de la pregunta actual priorizadas para no retrasar el examen;
- menú docente móvil convertido a drawer accesible con cierre por Escape;
- cronómetro/progreso y navegación estudiantil reforzados para móvil;
- compatibilidad específica 360, 390, 430, 768 y 1366 px;
- corregido overflow horizontal de 2 px detectado a 390/430 px;
- soporte `prefers-reduced-motion`, `100dvh` y safe-area;
- prueba visual Playwright/Chromium 28/28 PASS;
- auditoría estática de rendimiento/responsive 21/21 PASS.

## 0.16.0 — 2026-09-17

### Prompt 16 — Examen DEMO de Ingeniería de Seguridad

- añadido creador idempotente de curso, banco y examen DEMO;
- añadidas 15 preguntas superiores y un caso final con dos subpreguntas;
- incorporados alternativa única, selección múltiple, V/F, respuesta corta, numérica, desarrollo, imagen, cálculo, cálculo con evidencia, archivo y caso;
- añadida escena visual DEMO en `public/demo/seguridad-almacen.svg`;
- añadido soporte seguro para recursos visuales DEMO locales sin alterar el uso normal de Supabase Storage;
- añadido botón **Crear examen DEMO** en el panel docente;
- código de acceso DEMO generado por docente y almacenado mediante hash;
- añadida migración `0022_safety_demo_exam.sql`;
- añadido `scripts/demo-safety-exam-audit.mjs`;
- batería acumulativa completa verificada.

## 0.15.1 — 2026-09-17

### Auditoría estricta posterior al Prompt 15

- autoguardado convertido a escritura atómica por revisión;
- identidad del estudiante estabilizada por código universitario normalizado;
- prevención de evasión de intentos mediante cambio de correo;
- implementación real de resultados con respuestas correctas y retroalimentación;
- reingreso seguro a resultados diferidos sin crear nuevos intentos;
- embargo de claves correctas hasta el cierre general del examen;
- bloqueo de evidencias/archivos dentro de subpreguntas de caso;
- límites de texto y payload de respuestas;
- cierre por tiempo convertido en regla obligatoria coherente con el runtime;
- revisiones del cliente resistentes a retrocesos del reloj local;
- retiro de controles de configuración que simulaban persistencia;
- documentación técnica actualizada;
- añadido `scripts/strict-audit.mjs` y `npm run audit:strict`;
- añadida migración `0021_strict_audit_fixes.sql`.
