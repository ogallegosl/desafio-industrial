# Exportación de resultados — Prompt 13

## Alcance

El módulo de resultados permite exportar información del examen en tres formatos operativos:

- **Excel (.xlsx):** un libro con las hojas `Resultados` y `Detalle`.
- **CSV general:** una fila por intento.
- **CSV detallado:** una fila por pregunta de cada intento.

## Hoja Resultados

Incluye como mínimo:

- Código
- Apellidos
- Nombres
- Correo
- Curso
- Examen
- Inicio
- Fin
- Tiempo utilizado
- Correctas
- Incorrectas
- Omitidas
- Puntaje automático
- Puntaje manual
- Puntaje total
- Nota

Además incorpora sección, número de intento, estado, puntaje máximo y revisiones pendientes. No se exportan UUID, tokens, hashes ni claves internas.

## Hoja Detalle

Incluye como mínimo:

- Alumno
- Pregunta
- Respuesta
- Respuesta correcta
- Puntaje
- Tipo

Además incorpora código, correo, sección, intento, número de pregunta, puntaje máximo, resultado objetivo, estado de revisión y retroalimentación docente.

## Respuestas correctas

La clave correcta se obtiene mediante `get_exam_export_details(uuid)`, una función `security definer` que exige sesión autenticada y valida `private.owns_exam(...)`. La clave solo se entrega al docente autorizado para construir el archivo de exportación; no se añade a las respuestas del motor estudiantil.

## Tipos de pregunta

La exportación formatea:

- alternativa única y múltiple;
- verdadero/falso;
- respuesta corta;
- numérica;
- desarrollo;
- preguntas con imagen;
- cálculo;
- cálculo con evidencia;
- caso práctico con subpreguntas;
- archivo adjunto.

En preguntas manuales la columna `Respuesta correcta` indica `Revisión manual`. En cálculos con evidencia se incluye la respuesta numérica esperada y se indica que la evidencia es requerida.

## Excel

El archivo aplica:

- nombres de hoja estables;
- encabezados completos;
- autofiltro;
- anchos de columna limitados para mantener legibilidad;
- fechas como celdas de fecha;
- formato `yyyy-mm-dd hh:mm:ss`;
- compresión XLSX.

La generación se realiza en el navegador mediante SheetJS, dependencia que ya existía en el proyecto desde la importación masiva del Prompt 06.

## CSV

Los CSV se generan con codificación UTF-8 y BOM para conservar correctamente tildes y caracteres españoles al abrirse en Excel. Se ofrecen por separado `general` y `detallado` para evitar mezclar unidades de análisis.
