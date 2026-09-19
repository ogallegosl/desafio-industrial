# Configuración global — Prompt 20

## Alcance

La plataforma dispone de un registro persistente `public.configuracion_global` con `id = 1`. No contiene secretos y puede leerse desde las pantallas públicas para aplicar la identidad visual. Solo una cuenta activa con rol `teacher` o `admin` puede modificarlo.

## Parámetros disponibles

- nombre de la institución;
- nombre de la plataforma;
- subtítulo institucional/académico;
- logotipo JPG, PNG o WEBP;
- escala máxima predeterminada de nuevos exámenes;
- nota aprobatoria predeterminada;
- zona horaria IANA, por ejemplo `America/Lima`;
- formato de fecha: `DD/MM/YYYY`, `MM/DD/YYYY` o `YYYY-MM-DD`;
- tipos de evidencia permitidos entre JPG/JPEG, PNG, WEBP y PDF;
- tamaño máximo de cada evidencia entre 1 y 50 MB.

## Comportamiento académico

La escala máxima y la nota aprobatoria son **valores predeterminados para nuevos exámenes**. Un examen ya creado conserva los valores guardados en `configuraciones_examen`; modificar la configuración global no altera notas históricas ni evaluaciones existentes.

La zona horaria se utiliza al interpretar la fecha/hora introducida por el docente en el editor de exámenes. Los timestamps continúan almacenándose como `timestamptz` en PostgreSQL.

## Evidencias

Los tipos y el tamaño máximo de evidencia se aplican inmediatamente a nuevas cargas. Existen tres controles coherentes:

1. validación en la interfaz del estudiante;
2. validación en la Edge Function `exam-access`;
3. sincronización automática de `storage.buckets.student-evidence` mediante trigger.

La Edge Function continúa verificando extensión, MIME, tamaño y firma binaria real del archivo.

## Logotipo

El logotipo se almacena en el bucket público `branding`, ruta `global/...`. El recurso es público porque forma parte de la identidad visual y no contiene información sensible. Las operaciones de escritura/eliminación requieren una sesión docente activa.

Los buckets `question-media` y `student-evidence` continúan privados.

## Seguridad

`configuracion_global` utiliza RLS. El rol anónimo solo tiene lectura. Las cuentas autenticadas solo pueden actualizar si `private.current_app_role()` retorna `teacher` o `admin`.

La migración valida además:

- escala y nota aprobatoria;
- lista de MIME soportados;
- límite de 1–50 MB;
- formato de fecha;
- longitudes máximas de textos;
- identificador IANA de la zona horaria;
- uso exclusivo del bucket `branding` para el logotipo.
