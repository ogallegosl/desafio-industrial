# Importación masiva de preguntas — Prompt 06

## Objetivo

Permitir que el docente cargue preguntas desde Excel (XLSX/XLS) o CSV hacia un banco existente, con validación previa y sin insertar filas defectuosas.

## Plantillas

La aplicación publica:

- `/templates/plantilla_importacion_preguntas.xlsx`
- `/templates/plantilla_importacion_preguntas.csv`

La plantilla Excel incluye las hojas `Preguntas` e `Instrucciones`.

## Columnas obligatorias

`ID`, `Curso`, `Unidad`, `Tema`, `Subtema`, `Dificultad`, `Tipo`, `Pregunta`, `Alternativa_A`, `Alternativa_B`, `Alternativa_C`, `Alternativa_D`, `Respuesta`, `Puntaje`, `Tolerancia`, `Retroalimentacion`.

## Reglas de respuesta

- Alternativa única: una letra (`A`, `B`, `C` o `D`).
- Selección múltiple: letras separadas por `|`, por ejemplo `A|C`.
- Verdadero/Falso: `VERDADERO` o `FALSO`.
- Respuesta corta: una o varias respuestas separadas por `|`.
- Numérica / cálculo: valor numérico; la tolerancia es opcional y absoluta.
- Desarrollo / archivo: no requieren clave automática.

## Tipos no importables con la plantilla plana

- Imagen + alternativas.
- Imagen + desarrollo.
- Caso práctico.

Estos tipos requieren edición visual o estructura jerárquica y por ello generan un error explícito durante la validación en lugar de importarse de forma incompleta.

## Validaciones

Antes de guardar se comprueba:

- estructura de columnas;
- máximo de 1000 filas;
- ID obligatorio y no repetido dentro del archivo;
- ID previamente importado en el mismo banco;
- correspondencia entre `Curso` y el curso del banco;
- tipo reconocido;
- dificultad válida;
- enunciado obligatorio;
- alternativas y respuesta correcta coherentes;
- valores numéricos y tolerancia válidos;
- puntaje mayor o igual a cero.

Si existe al menos una fila con error, el botón de importación queda deshabilitado. El docente puede descargar un CSV con el número de fila y la descripción del error.

## Trazabilidad

Cada pregunta importada guarda en `metadata`:

- `importSourceId`;
- `importSource = bulk-file`;
- `importRow`;
- `importedAt`.

Esto permite detectar reimportaciones del mismo ID dentro del banco.

## Dependencia Excel

La lectura de XLSX/XLS/CSV utiliza SheetJS CE 0.20.3. El `package.json` referencia el tarball oficial del proyecto SheetJS debido a que el paquete `xlsx` del registro público de npm está desactualizado respecto del canal oficial.
