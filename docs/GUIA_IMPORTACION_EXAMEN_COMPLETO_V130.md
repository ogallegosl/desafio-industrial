# Guía — Importación automatizada de examen completo v1.3.0

## Flujo docente

Ruta: **Docente → Exámenes → Importar examen**.

El importador admite:

- `XLSX` o `XLS` para exámenes sin imágenes nuevas;
- `ZIP` para exámenes que incluyen fotografías. El ZIP debe contener exactamente un Excel y puede contener hasta 500 imágenes.

La plataforma analiza el paquete antes de escribir datos. Solo se habilita **Crear examen en borrador** cuando la validación completa no contiene errores.

## Plantilla

Archivo: `public/templates/plantilla_importacion_examen_completo.xlsx`.

### Hoja Configuracion

Campos principales:

- `Curso_Codigo`: obligatorio y utilizado como identificador estable del curso;
- `Curso_Nombre`: obligatorio;
- `Periodo_Academico`, `Seccion`, `Curso_Descripcion`: opcionales;
- `Banco_Predeterminado`: banco aplicado a filas que no indiquen uno;
- `Examen`: título obligatorio;
- `Duracion_Minutos`, `Numero_Preguntas`, `Nota_Maxima`, `Nota_Aprobatoria`, `Intentos`;
- `Aleatorizar_Preguntas`, `Aleatorizar_Alternativas`;
- `Navegacion`: `SECUENCIAL` o `LIBRE`;
- `Permitir_Retroceso`;
- `Codigo_Acceso`: opcional;
- `Inicio` y `Cierre`: opcionales, formato `AAAA-MM-DD HH:mm` en la zona horaria configurada.

Aunque se suministren código y fechas, el examen se crea siempre con estado **Borrador**.

### Hoja Preguntas

Columnas:

`ID`, `Banco`, `Unidad`, `Tema`, `Subtema`, `Dificultad`, `Tipo`, `Pregunta`, `Imagen`, `Alternativa_A`, `Alternativa_B`, `Alternativa_C`, `Alternativa_D`, `Respuesta`, `Puntaje`, `Tolerancia`, `Retroalimentacion`, `Incluir_Examen`, `Posicion`.

`Incluir_Examen=SI` convierte la fila en pregunta fija. `NO` deja la pregunta disponible en el banco para selección por reglas.

Tipos admitidos por el importador:

- Alternativa única;
- Selección múltiple;
- Verdadero/Falso;
- Respuesta corta;
- Numérica;
- Desarrollo;
- Imagen + alternativas;
- Imagen + desarrollo;
- Cálculo + resultado;
- Cálculo + evidencia;
- Respuesta con archivo.

`Caso práctico` continúa requiriendo el editor visual en v1.3.0.

### Hoja Reglas

Es opcional. Columnas:

`Banco`, `Unidad`, `Tema`, `Subtema`, `Dificultad`, `Tipo`, `Cantidad`, `Puntaje`, `Etiqueta`.

El total de preguntas del examen se calcula como:

`preguntas fijas + suma de Cantidad de todas las reglas`.

Este resultado debe coincidir con `Numero_Preguntas`.

## Fotografías

Para una pregunta visual:

1. selecciona `Imagen + alternativas` o `Imagen + desarrollo`;
2. escribe en la columna `Imagen` un nombre o ruta, por ejemplo `imagenes/SEG-041.jpg`;
3. guarda el Excel;
4. crea un ZIP con el Excel y la carpeta `imagenes`.

Ejemplo:

```text
PARCIAL_SEGURIDAD.zip
├── examen_seguridad.xlsx
└── imagenes
    ├── SEG-041.jpg
    ├── SEG-042.png
    └── SEG-043.webp
```

Formatos permitidos: JPG/JPEG, PNG y WEBP. Máximo 10 MB por imagen. La plataforma comprueba extensión, tamaño y firma binaria antes de crear el archivo que será enviado a Storage.

## Reconocimiento automático

### Curso

Se busca por `Curso_Codigo`.

- si no existe: se crea;
- si existe y el nombre coincide: se reutiliza;
- si el mismo código pertenece a otro nombre: la validación se detiene;
- si está archivado: debe restaurarse antes de importar.

### Banco

Dentro del curso se compara el nombre del banco.

- inexistente: se crea;
- existente y activo: se reutiliza;
- archivado: la importación se bloquea.

### Preguntas

El `ID` del Excel se almacena como `metadata.importSourceId`.

- si el ID no existe en el banco: se crea la pregunta;
- si existe, está activo y su contenido coincide: se reutiliza;
- si existe pero el contenido es diferente: la fila se bloquea para evitar sobrescritura silenciosa;
- si está archivado: debe restaurarse o utilizarse otro ID.

Para preguntas visuales reutilizadas puede omitirse la columna `Imagen` cuando la pregunta existente ya dispone de material gráfico.

## Idempotencia y trazabilidad

El archivo seleccionado se identifica mediante SHA-256. Cuando un examen se crea correctamente, la huella queda guardada en `configuraciones_examen.settings.import` junto con el nombre del archivo y la fecha de importación. Volver a cargar exactamente el mismo paquete se bloquea para evitar duplicados accidentales.

El editor de examen conserva esta información cuando posteriormente se modifican fechas, seguridad u otros campos.

## Validaciones previas

Entre otras condiciones, el importador bloquea:

- ID repetido dentro del paquete;
- curso sin código o nombre;
- código de curso asociado a otro nombre;
- banco archivado;
- tipo o dificultad no reconocidos;
- puntajes/tolerancias inválidos;
- respuestas objetivas incompletas;
- imágenes faltantes, corruptas o de formato no permitido;
- rutas ZIP con `..` o rutas absolutas;
- posiciones fijas duplicadas;
- reglas con menos candidatas de las solicitadas;
- diferencia entre `Numero_Preguntas` y el plan resultante;
- reimportación exacta de un paquete ya aplicado.

## Liberación

La importación automatiza la construcción, no la publicación. Al finalizar:

1. el examen queda en **Borrador**;
2. el docente revisa el editor y su plan;
3. se comprueban fechas y código de acceso;
4. recién después se programa o activa.
