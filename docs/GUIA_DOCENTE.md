# Guía del docente — EvaluaLab

## 1. Ingreso

Accede a `/docente/login` con la cuenta creada en Supabase Auth. La cuenta debe estar activa y tener rol `teacher` o `admin` en la plataforma.

## 2. Configuración inicial

Antes del primer examen revisa **Configuración** y define:

- institución y nombre de la plataforma;
- logotipo;
- escala máxima y nota aprobatoria predeterminadas;
- zona horaria;
- formato de fecha;
- formatos y tamaño máximo de evidencias.

Los cambios académicos se aplican como valores predeterminados a nuevos exámenes; no modifican evaluaciones históricas ya creadas.

## 3. Crear un curso

En **Cursos** crea el curso que agrupará bancos y exámenes. Evita cambiar el curso de un examen que ya tenga preguntas, reglas o intentos; el sistema bloquea ese cambio para preservar integridad.

## 4. Crear un banco de preguntas

En **Banco de preguntas** puedes crear preguntas de:

- alternativa única;
- selección múltiple;
- verdadero/falso;
- respuesta corta;
- numérica;
- desarrollo;
- imagen + alternativas;
- imagen + desarrollo;
- cálculo + resultado;
- cálculo + evidencia;
- caso práctico;
- respuesta con archivo.

Las imágenes se almacenan en Supabase Storage. Las evidencias del estudiante se guardan en un bucket privado.

## 5. Importar preguntas

Desde el banco puedes descargar la plantilla Excel/CSV, completarla y cargarla. El sistema valida cada fila antes de permitir la importación. Si existe un error, identifica la fila y el motivo.

Las preguntas con estructuras especiales —como casos jerárquicos o algunas preguntas basadas en imagen— deben completarse desde el editor para evitar importaciones incompletas.

## 6. Crear un examen

En **Exámenes → Crear examen** configura:

- título y curso;
- instrucciones;
- código de acceso;
- fecha y hora de inicio/cierre;
- duración;
- número máximo de intentos;
- escala y nota aprobatoria;
- identificación solicitada al alumno;
- navegación libre o secuencial;
- posibilidad de regresar a preguntas anteriores;
- aleatorización de preguntas y alternativas;
- información que verá el alumno al finalizar.

La creación y edición del examen se ejecutan de forma transaccional: examen, configuración y código se guardan como una sola operación lógica.

## 7. Seleccionar preguntas

Puedes añadir preguntas fijas o reglas aleatorias por banco, unidad, tema, subtema, dificultad y tipo. Antes de iniciar un intento, el sistema comprueba que haya suficientes preguntas disponibles.

Una vez generado el examen de un estudiante, sus preguntas y el orden de alternativas quedan congelados para ese intento.

## 8. Activar el examen

Antes de activarlo verifica:

- código de acceso definido;
- horario válido;
- duración;
- cantidad objetivo de preguntas;
- al menos un identificador estable del alumno: código universitario o correo.

El sistema impide programar/activar configuraciones incompletas.

## 9. Durante el examen

El cronómetro se calcula con el `deadline_at` del servidor. Recargar o cerrar el navegador no reinicia el tiempo. Las respuestas se autoguardan y, ante una interrupción breve de internet, existe una cola local que se sincroniza al recuperar conexión.

No se recomienda modificar bancos o reglas de selección mientras un examen está en ejecución.

## 10. Evidencias

Las preguntas de cálculo pueden exigir una fotografía o PDF del procedimiento. En **Evidencias** puedes abrir archivos mediante URLs temporales firmadas.

## 11. Calificación

Se califican automáticamente, según configuración:

- alternativas;
- selección múltiple;
- verdadero/falso;
- respuesta corta;
- numéricas exactas;
- numéricas con tolerancia;
- intervalos;
- cálculos.

Las respuestas de desarrollo, archivos y preguntas que requieran criterio docente pasan a revisión manual. Puedes usar rúbricas por criterios y dejar retroalimentación.

En preguntas con revisión manual, el puntaje docente sustituye el puntaje automático preliminar de esa pregunta; no se suman ambos.

## 12. Resultados

En **Resultados** consulta:

- participantes únicos;
- intentos;
- entregados y vencidos por tiempo;
- promedio, mediana, mínimo, máximo y desviación estándar;
- porcentaje de aprobación;
- rendimiento por pregunta;
- resultados detallados por estudiante e intento.

Las métricas de nota utilizan intentos cerrados con nota final disponible. Las revisiones pendientes se muestran por separado.

## 13. Exportar

Puedes descargar:

- Excel con hojas `Resultados` y `Detalle`;
- CSV general;
- CSV detallado.

Los archivos exportados no incluyen tokens, hashes, UUID internos innecesarios ni secretos.

## 14. Examen DEMO

En **Exámenes → Crear examen DEMO** puedes generar un curso, banco y examen demostrativo de Ingeniería de Seguridad. Está marcado como `[DEMO]` y no reemplaza información real.

## 15. Recomendaciones antes de un examen real

1. Ejecuta `npm run test:all` en el proyecto desplegado/local.
2. Verifica el examen desde una cuenta docente.
3. Haz al menos un intento de prueba desde un navegador distinto.
4. Confirma hora de inicio/cierre y zona horaria.
5. Comprueba que las imágenes y evidencias abren correctamente.
6. Revisa que la política de resultados sea la deseada.
7. No compartas claves administrativas de Supabase con estudiantes.

## Seguridad móvil e incidencias

El contador **Integridad** representa incidencias registradas durante el intento y se conserva al pasar del examen a la pantalla de revisión. No se reinicia al cambiar de vista.

En celulares, la plataforma intenta mantener la pantalla activa mediante Screen Wake Lock cuando el navegador lo admite. La simple pérdida de foco no se cuenta como incidencia móvil porque el teclado virtual y los permisos del sistema pueden producirla legítimamente; sí se registra cuando la página deja de estar visible.

Antes de una evaluación móvil conviene indicar a los estudiantes que carguen el equipo, eviten el modo de ahorro extremo y amplíen temporalmente el tiempo de bloqueo automático si su navegador no mantiene la pantalla encendida. Un navegador web no puede distinguir siempre entre bloquear manualmente la pantalla y cambiar a otra aplicación, por lo que las incidencias deben interpretarse como evidencia de revisión y no como anulación automática del examen.

## Monitoreo en vivo durante un examen

En **Exámenes**, abre **En vivo** en el examen programado o activo. El panel se actualiza automáticamente.

Puedes revisar por estudiante: estado, pregunta actual, avance, tiempo restante, última actividad, conexión reciente e incidencias de integridad. La matriz inferior indica qué preguntas fueron respondidas, pero no muestra la alternativa elegida ni si es correcta mientras el examen sigue abierto.

Acciones disponibles:

- **Cerrar nuevos ingresos**: impide crear nuevos intentos; los preparados/en curso continúan.
- **+5 min / +10 min**: amplía el tiempo individual o global.
- **Finalizar** en una fila: cierra solo ese intento.
- **Finalizar para todos**: cierra el examen completo y requiere confirmación.

Todas estas acciones quedan registradas en los logs del examen. Usa la finalización global solo cuando realmente quieras cortar la evaluación, porque no puede deshacerse.


## Importar un examen completo (v1.3.0)

1. Entra a **Exámenes → Importar examen**.
2. Descarga la plantilla oficial.
3. Completa `Configuracion`, `Preguntas` y, si corresponde, `Reglas`.
4. Si utilizas `Imagen + alternativas` o `Imagen + desarrollo`, coloca el Excel y las imágenes en un ZIP. En la columna `Imagen` escribe, por ejemplo, `imagenes/SEG-041.jpg`.
5. Selecciona el XLSX/XLS o ZIP. La plataforma realiza primero una validación sin escribir en Supabase.
6. Revisa el resumen: curso, bancos, preguntas nuevas/reutilizadas, imágenes, preguntas fijas, reglas y duración.
7. Corrige cualquier error indicado. Mientras exista un error, el botón de creación permanece bloqueado.
8. Pulsa **Crear examen en borrador**. El sistema crea/reutiliza el curso y los bancos, guarda las preguntas e imágenes y construye el plan.
9. Al terminar se abre el editor del examen. Revisa configuración, fechas, código de acceso y plan antes de programar o activar.

No vuelvas a importar exactamente el mismo archivo para duplicar un examen: la huella SHA-256 lo bloqueará. Para reutilizar una evaluación existente usa **Duplicar** o modifica el paquete para una nueva evaluación.
