# Examen DEMO — Ingeniería de Seguridad

## Objetivo

El Prompt 16 incorpora un conjunto de datos demostrativos que permite probar el flujo integral de EvaluaLab sin modificar cursos, bancos o exámenes reales del docente.

Todos los registros creados por esta función utilizan el prefijo `[DEMO]` y el marcador interno `[DEMO_DATA_PROMPT16]`.

## Cómo crear el DEMO

1. Inicia sesión como docente activo.
2. Ve a **Panel docente → Exámenes**.
3. Pulsa **Crear examen DEMO**.
4. La plataforma crea o reactiva el mismo DEMO; no genera duplicados al pulsar nuevamente.
5. El sistema muestra el código de acceso generado para ese docente.

La función utilizada es:

```sql
public.create_safety_demo()
```

Solo puede ejecutarla un usuario autenticado con perfil docente activo.

## Datos creados

- Curso: `[DEMO] Ingeniería de Seguridad`
- Banco: `[DEMO] Banco integral de Seguridad`
- Examen: `[DEMO] Examen integral — Ingeniería de Seguridad`
- Duración: 45 minutos
- Intentos máximos: 3
- Preguntas superiores: 15
- Orden de preguntas: aleatorio
- Orden de alternativas: aleatorio
- Escala: 0–20
- Nota aprobatoria: 10.5
- Ventana de prueba: 30 días desde la creación o reactivación

## Tipos incluidos

1. Alternativa única — concepto de peligro.
2. Verdadero/Falso — secuencia IPERC.
3. Alternativa única — jerarquía de controles.
4. Numérica con tolerancia — iluminancia promedio.
5. Numérica exacta — valoración básica del riesgo.
6. Imagen + alternativa — inspección visual de almacén.
7. Desarrollo — diferencia entre peligro y riesgo.
8. Cálculo — dosis simplificada de ruido.
9. Cálculo + evidencia — resultado y fotografía/PDF del procedimiento.
10. Selección múltiple — factores ergonómicos.
11. Respuesta corta — sigla IPERC.
12. Verdadero/Falso — unidad de iluminancia.
13. Imagen + desarrollo — condiciones inseguras y controles.
14. Archivo adjunto — mini-IPERC aplicado.
15. Caso integrado — ergonomía, manipulación manual e IPERC, con dos subpreguntas.

## Material visual DEMO

El archivo:

`public/demo/seguridad-almacen.svg`

representa una escena didáctica con un extintor obstruido, una zona de paso y un cable atravesando el tránsito. Se utiliza únicamente para demostrar preguntas visuales.

El motor de examen admite este recurso local mediante `metadata.demoMediaUrl`. Las imágenes creadas normalmente por el docente continúan utilizando Supabase Storage privado.

## Idempotencia

Si el docente pulsa nuevamente **Crear examen DEMO**, la función busca el examen DEMO de esa misma cuenta. Si existe:

- no crea un segundo curso;
- no duplica el banco;
- no duplica las preguntas;
- renueva la ventana de prueba;
- reactiva el examen;
- conserva el mismo conjunto demostrativo.

## Uso académico

El contenido está diseñado para probar funciones de la plataforma. No debe utilizarse como instrumento validado de evaluación académica ni como referencia normativa definitiva. Las fórmulas de dosis incluidas están señaladas como ejercicios didácticos simplificados.
