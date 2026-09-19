# Desafío Industrial — Evaluación universitaria flexible

**Versión 1.3.0** de la plataforma de evaluación para **Ingeniería Industrial UNSA**.

Desafío Industrial permite crear exámenes con preguntas aleatorias, imágenes, cálculos, desarrollo, evidencias, calificación automática/manual, analítica y reportes individuales. La versión 1.3.0 conserva el monitoreo docente en vivo y añade **importación automatizada de exámenes completos**: curso, bancos, preguntas, fotografías, preguntas fijas y reglas aleatorias pueden prepararse desde una plantilla Excel o un paquete ZIP.

## Principales funciones

- React + Vite, responsive para computadora, tablet y celular;
- Supabase/PostgreSQL con **27 migraciones** y Row Level Security;
- acceso estudiantil por código de examen y **solo Apellidos + Nombres**;
- bancos de preguntas, 12 tipos de pregunta, imágenes y casos;
- **importación de examen completo por XLSX/XLS o ZIP**, con creación/reutilización de curso y bancos;
- preguntas visuales masivas mediante carpeta de imágenes y asociación por nombre/ruta;
- validación previa sin escritura, reutilización segura por ID y detección de paquetes ya importados por SHA-256;
- preguntas/alternativas aleatorias y snapshot congelado por intento;
- cronómetro de servidor, autoguardado, cola offline y recuperación ante fallos;
- evidencias JPG/PNG/WEBP/PDF con almacenamiento privado;
- fotografías comprimidas automáticamente antes de subir;
- cámara con `getUserMedia` y fallback a selector de archivos;
- calificación automática, rúbricas y revisión manual;
- resultados por examen, pregunta y estudiante;
- Excel/CSV y **PDF individual por intento**;
- modo DEMO local mediante `DEMO2026` sin Supabase;
- **monitoreo en vivo** para el docente mediante Supabase Realtime;
- avance, pregunta actual, respuestas completadas, tiempo restante, conexión e incidencias por estudiante;
- cierre de nuevos ingresos sin interrumpir intentos ya iniciados;
- extensión de +5/+10 minutos por alumno o para todos;
- finalización individual o global del examen con registro de auditoría.


## Importación automatizada de examen completo

Desde **Docente → Exámenes → Importar examen** puede cargarse:

- un **XLSX/XLS** cuando el examen no necesita imágenes nuevas;
- un **ZIP** que contenga un único Excel y las imágenes referenciadas en la columna `Imagen`.

La plantilla oficial es `public/templates/plantilla_importacion_examen_completo.xlsx` y el paquete de ejemplo es `public/templates/ejemplo_paquete_examen_imagenes.zip`. El importador valida el archivo antes de escribir datos, reconoce el curso mediante `Curso_Codigo`, crea o reutiliza bancos, evita duplicar preguntas compatibles por `ID`, bloquea conflictos de contenido, valida el plan fijo/aleatorio y deja el examen **siempre en Borrador**.

Los tipos visuales admitidos son **Imagen + alternativas** e **Imagen + desarrollo**. Las imágenes deben ser JPG/JPEG, PNG o WEBP, con un máximo de 10 MB cada una. `Caso práctico` continúa requiriendo el editor visual en v1.3.0.

Consulta `docs/GUIA_IMPORTACION_EXAMEN_COMPLETO_V130.md`.

## Seguridad del examen

Los nuevos exámenes pueden aplicar de forma predeterminada:

- pantalla completa obligatoria;
- detección de cambio de pestaña y pérdida de foco;
- bloqueo de copiar, cortar y pegar;
- bloqueo de menú contextual;
- bloqueo best-effort de atajos de imprimir/guardar/ver código/herramientas de desarrollo;
- advertencia ante intentos de impresión y `PrintScreen` cuando el navegador permite detectarlo;
- marca de agua con el nombre del estudiante;
- registro de incidencias asociado al intento;
- detección best-effort de pantalla extendida;
- opción para requerir Safe Exam Browser (SEB);
- navegación secuencial sin retroceso como valor predeterminado para nuevos exámenes.

Una aplicación web no puede impedir físicamente el uso de un segundo celular o garantizar el bloqueo total del sistema operativo. Para evaluaciones de alta exigencia se recomienda combinar estas medidas con Safe Exam Browser y supervisión presencial.


## Monitoreo en vivo

Desde **Exámenes → En vivo**, el docente puede seguir el avance de la evaluación sin ver las respuestas ni si son correctas mientras el alumno está rindiendo. La pantalla se actualiza con Supabase Realtime y mantiene un sondeo de respaldo cada 15 segundos.

El panel muestra:

- participantes únicos;
- estudiantes rindiendo, preparados y entregados;
- pregunta actual y cantidad respondida;
- tiempo restante y ampliaciones otorgadas;
- última actividad y señal reciente del navegador;
- incidencias de integridad;
- matriz P1…Pn con estados **respondida / actual / pendiente**.

Controles disponibles:

- **Cerrar nuevos ingresos**: no afecta a quienes ya tienen un intento preparado o en curso;
- **+5 / +10 min a todos**;
- **+5 / +10 min a un estudiante**;
- **Finalizar un intento**;
- **Finalizar para todos**: cierra el examen, envía los intentos en curso y cancela los intentos preparados que todavía no empezaron.

Los alumnos comprueban el estado del intento cada 5 segundos. Si el docente amplía el tiempo, el cronómetro se actualiza sin recargar. Si finaliza el examen, el alumno es llevado a la pantalla de cierre. Las respuestas que ya estaban en la cola offline antes del corte docente pueden recuperarse durante una ventana técnica breve y auditada.

## Compatibilidad móvil e integridad

La interfaz se auditó específicamente en **320, 360, 390, 430, 768 y 1366 px** para portada, acceso, instrucciones, examen y revisión. El examen solicita un **Screen Wake Lock** cuando el navegador lo permite para evitar que el celular apague automáticamente la pantalla mientras el alumno realiza cálculos manuales.

En dispositivos móviles se evita contabilizar como incidencia la simple pérdida de foco del navegador, porque teclados, permisos y elementos del sistema pueden producirla legítimamente. El cambio real de visibilidad de la página continúa registrándose. La plataforma no puede distinguir con certeza entre un bloqueo manual de pantalla y un cambio intencional a otra aplicación; por eso se recomienda ampliar temporalmente el bloqueo automático de pantalla antes del examen si el navegador no admite Wake Lock.

El contador de integridad se recupera desde el intento almacenado en servidor (o `localStorage` en DEMO), por lo que ya no vuelve a cero al pasar de **Revisar** a **Enviar**.

## Evidencias ligeras

Las fotografías se redimensionan y comprimen en el navegador antes de subirlas. El objetivo es alrededor de **650 KB por fotografía**, con un límite global predeterminado de **5 MB** por evidencia. Los PDF no se recomprimen automáticamente.

## PDF individual del examen

Después de cerrar un intento:

- el estudiante puede usar **Descargar mi examen (PDF)** desde la pantalla final;
- el docente puede ir a **Resultados → Por estudiante → Descargar PDF**;
- el PDF docente incluye preguntas, respuestas, criterio/respuesta correcta disponible, puntaje, retroalimentación e incidencias de integridad.

## Desarrollo local

```bash
npm install
npm run dev
```

Prueba local sin Supabase:

```text
Código: DEMO2026
```

## Variables para Supabase

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Producción

Antes de utilizar con estudiantes reales:

```bash
npm run test:all
npm run audit:security
npm run audit:v110
npm run audit:v111
npm run audit:v120
npm run audit:v130
npm run test:mobile111
npm run build
```

Después aplica las 27 migraciones y despliega la Edge Function `exam-access` en Supabase. Consulta `docs/DEPLOY_NETLIFY.md`.

## Nota sobre identificación por nombres

Por solicitud de diseño, el estudiante solo introduce apellidos y nombres. Internamente se genera un identificador técnico por examen. Si dos estudiantes tienen **exactamente los mismos apellidos y nombres** en una misma evaluación, el sistema no dispone de información visible adicional para distinguirlos; en ese caso conviene diferenciarlos previamente en la matrícula o volver a habilitar un identificador institucional en una futura versión.

## Pruebas

```bash
npm run test:all
npm run audit:v110
npm run audit:v111
npm run audit:v120
npm run audit:v130
npm run test:mobile111
npm run audit:package
```

La batería acumulativa, las auditorías v1.1.1/v1.2.0/v1.2.1/v1.3.0 y la auditoría móvil deben finalizar en PASS antes del despliegue.
