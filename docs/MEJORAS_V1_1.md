# Desafío Industrial v1.1.0 — Mejoras implementadas

## Seguridad

El examen puede exigir pantalla completa, bloquear operaciones de portapapeles y menú contextual, detectar cambios de pestaña, pérdida de foco, pantallas extendidas y atajos sensibles, aplicar marca de agua y registrar incidencias asociadas al intento. El docente puede revisar el número de incidencias en Resultados.

La opción **Requerir Safe Exam Browser** impide iniciar desde un navegador común mediante detección del cliente. Esta comprobación web es una capa adicional y no sustituye la validación criptográfica Browser Exam Key / Config Key de una integración SEB avanzada.

## Cámara y evidencias

**Abrir cámara / tomar foto** utiliza `navigator.mediaDevices.getUserMedia`. En una computadora con webcam abre la cámara; si el equipo no tiene cámara, el navegador no concede permiso o la API no está disponible, se abre el selector de archivo. Las fotografías se comprimen antes de la carga para reducir tiempo y consumo de red.

## Envío del examen

El DEMO local consolida respuestas pendientes en una sola operación antes del envío, evitando serializaciones repetidas de `localStorage`. La pantalla final utiliza directamente la respuesta del envío cuando está disponible, eliminando una consulta redundante.

## PDF individual

El estudiante puede descargar un comprobante PDF al finalizar. En el panel docente, cada intento cerrado tiene la acción **Descargar PDF** con el detalle completo disponible para el docente.

## Identificación

El acceso estudiantil solicita únicamente **Apellidos** y **Nombres**. La limitación inherente es que dos personas con exactamente el mismo nombre completo no pueden distinguirse con certeza sin un identificador adicional.
