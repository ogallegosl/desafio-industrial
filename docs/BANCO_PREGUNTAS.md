# Banco de preguntas — Prompt 05

## Alcance implementado

El panel docente dispone ahora de bancos y preguntas persistentes en Supabase.

### Bancos

- Crear y editar bancos por curso.
- Archivar y restaurar sin eliminar datos.
- Conteo de preguntas y filtro directo por banco.

### Clasificación de preguntas

Cada pregunta puede registrar:

- curso mediante su banco;
- unidad;
- tema;
- subtema;
- dificultad: básica, intermedia o avanzada;
- tipo;
- puntaje;
- retroalimentación;
- estado activo/archivado.

### Tipos disponibles

1. Alternativa única.
2. Selección múltiple.
3. Verdadero/Falso.
4. Respuesta corta.
5. Respuesta numérica.
6. Desarrollo.
7. Imagen + alternativas.
8. Imagen + desarrollo.
9. Cálculo + resultado.
10. Cálculo + evidencia.
11. Caso práctico con subpreguntas.
12. Respuesta con archivo adjunto.

Los casos prácticos se modelan mediante una pregunta padre `case_group` y subpreguntas persistidas como registros hijos. La migración `0011_question_bank_management.sql` impide casos anidados y obliga a que padre e hijos pertenezcan al mismo banco.

## Imágenes

Bucket privado: `question-media`.

Formatos admitidos:

- JPG/JPEG;
- PNG;
- WEBP.

Límite configurado en Storage y validado en el navegador: 10 MB.

Ruta recomendada y utilizada:

`question-media/<usuario-docente>/<pregunta>/<archivo>`

La previsualización usa URL firmada temporal. El bucket no se hace público.

## Corrección configurada

- Alternativa única: una respuesta correcta.
- Selección múltiple: una o más respuestas correctas.
- Verdadero/Falso: valor booleano.
- Respuesta corta: una o varias respuestas aceptables y modo de comparación.
- Numérica/cálculo: valor esperado y tolerancia.
- Desarrollo/imagen + desarrollo/archivo: revisión manual.
- Cálculo + evidencia: resultado numérico más requisito de evidencia para la etapa correspondiente.

## Operaciones

La pantalla permite:

- buscar;
- filtrar por curso, banco, tipo, dificultad, unidad, tema y estado;
- crear;
- editar;
- duplicar;
- archivar/restaurar;
- previsualizar.

Duplicar una pregunta genera registros independientes. Si existe imagen, se copia a una ruta propia usando Supabase Storage.
