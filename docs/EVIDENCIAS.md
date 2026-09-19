# Evidencias del estudiante — Prompt 09

## Alcance

La plataforma admite evidencias en preguntas de tipo:

- `calculation_evidence`: resultado numérico + archivo de procedimiento;
- `attachment`: respuesta basada en un archivo.

Formatos permitidos:

- JPEG/JPG;
- PNG;
- WEBP;
- PDF.

Tamaño máximo: **configurable entre 1 y 50 MB por evidencia** desde Configuración global. El valor inicial es 15 MB.

## Flujo del estudiante

1. El alumno selecciona un archivo o, en un móvil compatible, usa **Tomar foto**.
2. El navegador valida formato y tamaño antes de cargarlo.
3. La Edge Function valida que el intento siga en curso y que la pregunta admita evidencia.
4. Se crea una autorización temporal de 15 minutos para una ruta concreta del bucket privado `student-evidence`.
5. El navegador sube el archivo directamente a Supabase Storage mediante el token firmado.
6. La Edge Function verifica que el objeto existe y registra la evidencia en PostgreSQL.
7. Si había una evidencia activa para esa pregunta, se reemplaza y el archivo anterior se elimina.
8. Mientras el intento continúe abierto, el alumno puede eliminar la evidencia y subir otra.

## Privacidad

`student-evidence` continúa siendo un bucket privado.

El estudiante no recibe permisos generales de lectura o escritura. Las cargas usan una autorización firmada para un solo objeto. Las vistas previas se entregan mediante URLs temporales.

El docente autenticado solo puede consultar evidencias de intentos sobre los que tiene autorización RLS.

## Trazabilidad

La tabla `evidencias` registra:

- intento;
- pregunta congelada del intento;
- respuesta asociada;
- ruta del objeto;
- nombre original;
- tipo MIME;
- tamaño;
- fecha y hora de carga;
- metadatos del proceso de carga.

La tabla `cargas_evidencia_temporales` registra las autorizaciones de subida hasta que se finalizan.

Los eventos también quedan en `logs` como:

- `EVIDENCE_UPLOADED`;
- `EVIDENCE_REPLACED`;
- `EVIDENCE_DELETED`.

## Integridad de la respuesta

Para `calculation_evidence`, una pregunta se considera respondida únicamente cuando existe:

- un resultado numérico válido; y
- una evidencia activa.

Para `attachment`, una pregunta se considera respondida únicamente cuando existe una evidencia activa.

La ausencia de evidencia no impide necesariamente enviar el examen: la pregunta queda registrada como omitida, igual que cualquier otra pregunta sin responder.

## Panel docente

`/docente/evidencias` consulta únicamente evidencias activas correspondientes a intentos `submitted` o `time_expired`.

El docente puede:

- buscar por alumno, examen o archivo;
- ver el enunciado y puntaje de la pregunta;
- visualizar imágenes;
- visualizar PDF en el navegador cuando este lo permita;
- abrir el archivo mediante un enlace firmado temporal.

La asignación de puntajes y rúbricas corresponde al Prompt 11.

## Consideración operativa

La carga de archivos requiere conexión. El autoguardado de respuestas de texto/número mantiene su mecanismo offline, pero una fotografía o PDF no se considera subido hasta que Supabase confirme el archivo y la Edge Function lo finalice.
