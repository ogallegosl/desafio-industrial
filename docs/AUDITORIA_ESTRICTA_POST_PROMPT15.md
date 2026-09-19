# Auditoría estricta posterior al Prompt 15

**Fecha:** 17 de septiembre de 2026  
**Alcance:** versión acumulativa de los Prompts 00–15.

## Resultado

La auditoría revisó frontend, servicios, Edge Function, migraciones PostgreSQL, RLS, Storage, cronómetro, aleatorización, autoguardado, evidencias, calificación, resultados, exportación y recuperación ante fallas.

Se detectaron defectos que no aparecían en las simulaciones originales porque varias pruebas habían sido creadas junto con la misma implementación. Los defectos corregidos se resumen a continuación.

## Hallazgos corregidos

### 1. Condición de carrera en el autoguardado — severidad alta

**Problema:** dos solicitudes concurrentes podían leer la misma revisión previa y una respuesta más antigua podía terminar sobrescribiendo una más reciente.

**Corrección:** se añadió `save_attempt_answer_if_newer(...)`, que compara y escribe la revisión en una sola sentencia PostgreSQL. El servidor acepta únicamente una revisión estrictamente mayor.

### 2. Posible evasión del límite de intentos mediante identidad duplicada — severidad alta

**Problema:** en exámenes abiertos el mismo código universitario con otro correo podía crear otro registro de estudiante. En exámenes restringidos, cuando se enviaban código y correo, bastaba que coincidiera uno de ellos.

**Corrección:** el código universitario se convirtió en identidad estable global, se normaliza en mayúsculas, tiene índice único case-insensitive y un trigger mantiene esa normalización en futuras altas. Cuando se proporcionan código y correo, ambos deben corresponder al mismo estudiante.

### 3. Opciones de resultados configurables pero incompletas — severidad alta

**Problema:** `correct_answers` y `full_feedback` podían seleccionarse en el editor, pero la pantalla final no entregaba realmente ese detalle.

**Corrección:** el backend puede entregar el detalle congelado del intento y la pantalla final muestra respuesta del alumno, respuesta correcta, puntaje y retroalimentación docente según la opción configurada. Las claves correctas permanecen embargadas hasta que cierre la ventana general del examen, evitando que un alumno que entrega antes las revele a compañeros que aún están rindiendo.

### 4. Resultados diferidos inaccesibles después de expirar la sesión — severidad alta

**Problema:** el docente podía configurar `show_results_after` para una fecha posterior, pero una vez vencida la sesión temporal y cerrado el examen el estudiante no tenía una ruta segura para volver a consultar la nota.

**Corrección:** se añadió un flujo `validate_results` / `result_access`. El estudiante vuelve a introducir el código del examen y su identidad; el sistema localiza únicamente un intento ya cerrado, no crea uno nuevo, emite una sesión temporal de consulta y respeta `result_visibility`, `show_results_after` y el embargo de respuestas correctas hasta el cierre general.

### 5. Subpreguntas de caso incompatibles con evidencias — severidad media

**Problema:** un `case_group` podía contener `calculation_evidence` o `attachment`, aunque las evidencias se vinculan a preguntas de intento de nivel superior.

**Corrección:** estos tipos ya no pueden seleccionarse como subpreguntas. La restricción existe en interfaz, servicio y trigger de base de datos.

### 6. Payload de respuestas sin límites suficientes — severidad media

**Problema:** el cliente podía enviar texto o JSON excesivamente grande.

**Corrección:** se añadieron límites de longitud por tipo de respuesta, máximo de 64 KB para payload estructurado y constraint de base de datos para `answer_text`.

### 7. Interruptor de cierre por tiempo que no representaba el comportamiento real — severidad media

**Problema:** la interfaz permitía desactivar el envío/cierre automático, pero el motor mantenía un plazo duro y cerraba el intento igualmente.

**Corrección:** el plazo duro se declaró obligatorio. La interfaz ya no presenta un control que sugiera que puede desactivarse y la base de datos exige `auto_submit_on_timeout = true`.

### 8. Revisiones del cliente dependientes del reloj local — severidad media

**Problema:** si el reloj del dispositivo retrocedía, una revisión nueva podía resultar menor que una ya guardada y ser descartada.

**Corrección:** el generador de revisiones mantiene un piso monotónico y se inicializa con las revisiones del servidor y de la cola offline.

### 9. Configuración institucional simulada — severidad baja

**Problema:** la pantalla de configuración mostraba controles sin persistencia real, lo que podía hacer creer al docente que los cambios se habían guardado.

**Corrección:** esos controles fueron retirados. La pantalla informa con precisión que la configuración global persistente corresponde a una etapa posterior.

### 10. Documentación desactualizada — severidad baja

**Problema:** varios documentos todavía afirmaban que evidencias, envío o persistencia eran funciones futuras, aunque ya estaban implementadas.

**Corrección:** se actualizaron README, arquitectura, autenticación, motor de examen, base de datos y documentación de migraciones.

## Validaciones ejecutadas

- aleatorización: PASS;
- motor del examen: PASS;
- evidencias: 13/13 PASS;
- calificación automática: 26 comprobaciones PASS;
- calificación manual: 24 comprobaciones PASS;
- resultados/analítica: 16 comprobaciones PASS;
- exportación: 18 comprobaciones PASS;
- seguridad: 17/17 PASS;
- recuperación ante fallas: 23/23 PASS;
- auditoría estricta adicional: 26/26 PASS;
- análisis sintáctico JS/JSX/TS/TSX/MJS: 74 archivos, 0 errores;
- imports relativos: 0 faltantes.

## Limitaciones que permanecen

### Ejecución real de PostgreSQL/Supabase

Este entorno no dispone de una instancia PostgreSQL/Supabase conectada ni de `psql`/Supabase CLI funcional para ejecutar las 21 migraciones extremo a extremo. La migración `0021_strict_audit_fixes.sql` fue revisada estructuralmente, incluida en `bootstrap_all.sql` y acompañada de consultas de verificación, pero debe probarse en una instancia real antes de utilizar la plataforma con estudiantes.

### Build de producción

No se pudo ejecutar `npm run build` porque las dependencias no están instaladas y el entorno no dispone de la caché necesaria para `npm install --offline`. La sintaxis y los imports sí fueron comprobados independientemente.

### Recuperación offline post-vencimiento

La ventana técnica de 5 minutos preserva respuestas que estaban en la cola local antes del vencimiento. Como el navegador del alumno no es un entorno confiable, un usuario técnicamente avanzado podría intentar alterar metadatos locales. La ventana es breve, auditada y no reabre ni amplía el examen, pero no ofrece una prueba criptográfica del instante exacto en que una respuesta se generó offline. Para evaluaciones de muy alto riesgo puede optarse posteriormente por un modo estricto sin recuperación post-vencimiento.

### Fraude externo

La aplicación no puede impedir que un estudiante use un segundo dispositivo, fotografíe la pantalla o comparta información fuera del sistema. Los controles implementados reducen manipulación técnica de la plataforma, no sustituyen supervisión cuando la evaluación la requiera.

### Identificación basada solo en correo

Si un examen abierto se configura sin código universitario y utiliza únicamente correo no verificado, una persona puede introducir otra dirección y ser tratada como otra identidad. Para evaluaciones con control estricto de intentos debe mantenerse **Código universitario** como campo obligatorio o restringir el examen a una matrícula previamente cargada.

## Puerta de salida antes de producción

No utilizar con estudiantes reales hasta completar en una instancia de prueba:

1. aplicar `bootstrap_all.sql` o las 21 migraciones en orden;
2. ejecutar `supabase/sql/verification_queries.sql`;
3. desplegar `exam-access` con `APP_ALLOWED_ORIGINS` configurado;
4. instalar dependencias y ejecutar `npm run build`;
5. ejecutar `npm run audit:security`, `npm run audit:strict` y `npm run test:recovery`;
6. realizar una prueba extremo a extremo con al menos dos docentes y varios estudiantes simulados;
7. verificar carga real de imágenes/PDF, vencimiento, pérdida de conexión, corrección y exportación.
