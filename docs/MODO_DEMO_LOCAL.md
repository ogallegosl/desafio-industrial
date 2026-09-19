# Modo DEMO local — EvaluaLab 1.0.1

## Objetivo

Permite evaluar el flujo del estudiante sin configurar Supabase. El código de acceso es:

```text
DEMO2026
```

También aparece un botón **Probar DEMO local · DEMO2026** en la pantalla de acceso.

## Qué permite probar

- identificación del estudiante;
- pantalla de instrucciones;
- inicio del intento;
- cronómetro de 30 minutos;
- 15 preguntas de Ingeniería de Seguridad;
- alternativa única;
- selección múltiple;
- verdadero/falso;
- respuesta corta;
- respuesta numérica;
- desarrollo;
- preguntas con imagen;
- cálculo;
- cálculo con evidencia;
- archivo adjunto;
- caso con subpreguntas;
- autoguardado;
- navegación entre preguntas;
- revisión final;
- envío;
- corrección automática de preguntas objetivas;
- visualización de respuestas correctas;
- simulación de respuestas pendientes de revisión manual;
- consulta del resultado local.

## Persistencia

El DEMO utiliza `localStorage` y `sessionStorage` del navegador. No envía información a Supabase ni a otro servidor.

Al recargar el navegador durante un intento, se recuperan el intento, las respuestas y el tiempo original.

Las evidencias de prueba se registran localmente. En imágenes pequeñas también puede conservarse una previsualización; en archivos grandes se conserva únicamente la metadata necesaria para simular el flujo.

## Iniciar otro intento

Después de enviar el examen:

1. pulsa **Salir**;
2. vuelve a **Acceso del estudiante**;
3. usa nuevamente `DEMO2026`;
4. EvaluaLab creará un nuevo intento local.

## Limitaciones

El modo DEMO local está diseñado para revisar la experiencia del estudiante. No sustituye la conexión real con Supabase y no permite validar:

- autenticación docente real;
- persistencia multiusuario;
- supervisión simultánea de estudiantes;
- base de datos central;
- Storage real;
- RLS;
- Edge Functions desplegadas;
- resultados institucionales y exportaciones basadas en datos reales.

Para esas pruebas debe desplegarse la infraestructura Supabase descrita en `docs/DEPLOY_NETLIFY.md`.
