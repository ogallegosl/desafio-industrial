# Auditoría general — Desafío Industrial v1.3.0

Fecha: 18/09/2026.

## Cambio principal

Se añadió importación automatizada de exámenes completos desde XLSX/XLS o ZIP. El flujo puede crear o reutilizar curso y bancos, importar preguntas nuevas, reutilizar preguntas compatibles por ID, subir imágenes, vincular preguntas fijas y crear reglas aleatorias. Todo examen importado queda en Borrador.

## Controles del importador v1.3.0

Resultado: **25/25 PASS**, sin fallos critical/high.

Se verificó:

- versión y dependencia JSZip fijada;
- botón y modal de importación;
- plantilla XLSX y paquete ZIP de ejemplo;
- bloqueo de rutas ZIP inseguras;
- límites de tamaño comprimido, descomprimido e imágenes;
- formatos JPG/JPEG, PNG y WEBP;
- validación de firma binaria del archivo gráfico;
- SHA-256 para impedir reimportaciones accidentales;
- reconocimiento seguro del curso por código;
- creación/reutilización de bancos y bloqueo de bancos archivados;
- creación/reutilización segura de preguntas por ID;
- preguntas de Imagen + alternativas e Imagen + desarrollo;
- bloqueo de imágenes faltantes;
- preguntas fijas y reglas aleatorias;
- coherencia entre `Numero_Preguntas` y el plan;
- ausencia de publicación/activación automática;
- trazabilidad de la importación en `settings.import`;
- preservación de esa trazabilidad al editar el examen;
- rechazo explícito de Caso práctico en el importador v1.3.0;
- progreso visible por etapas.

## Regresión acumulativa

`npm run test:all`: **PASS**.

Resultados incluidos en la suite:

- seguridad: **17/17 PASS**;
- recuperación ante fallas: **23/23 PASS**;
- auditoría estricta: **26/26 PASS**;
- DEMO: **32/32 PASS**;
- v1.1: **31/31 PASS**;
- v1.1.1: **17/17 PASS**;
- monitoreo v1.2.0: **26/26 PASS**;
- auditoría docente v1.2.1+: **63/63 PASS**;
- importador v1.3.0: **25/25 PASS**.

`npm run audit:package`: **PASS**, versión 1.3.0, 27 migraciones.

`npm run deploy:check`: **20/20 PASS**.

La plantilla y el ZIP de ejemplo se abrieron y verificaron de forma independiente: hojas `Configuracion`, `Preguntas`, `Reglas`, `Instrucciones`; columnas visuales presentes; dos imágenes de ejemplo correctamente incluidas dentro de `imagenes/`.

## Limitación de validación en este entorno

La instalación `npm install` agotó el tiempo de red disponible. En consecuencia, `npm run build` no pudo ejecutarse porque Vite no está instalado localmente (`vite: not found`). Este resultado no demuestra un error de código; significa que el build real de Vite debe repetirse después de instalar dependencias en un equipo con acceso normal a npm.

Tampoco se ejecutó un E2E real contra una instancia Supabase vinculada. Antes de usar v1.3.0 en una evaluación oficial se mantiene la obligación de desplegar en un entorno de prueba y validar: importación de un ZIP real con imágenes, Storage privado, creación/reutilización de bancos, acceso del alumno, Realtime, calificación y exportaciones.

## Criterio de liberación

v1.3.0 queda aprobada a nivel de código, simulaciones, auditoría estática, estructura de plantilla y regresión acumulativa. La liberación a producción requiere instalar dependencias, ejecutar el build y completar el E2E real con Supabase/Netlify.
