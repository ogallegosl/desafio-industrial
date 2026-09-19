# QA_REPORT — Prompt 17

Fecha de ejecución: 17 de septiembre de 2026  
Versión evaluada: 0.17.0  
Base: versión acumulativa hasta Prompt 16, incluida la auditoría estricta posterior al Prompt 15.

## 1. Resultado ejecutivo

**Estado de la batería QA implementada: PASS.**

La auditoría del Prompt 17 añadió una batería independiente a las simulaciones existentes y volvió a ejecutar toda la suite acumulativa. No quedaron defectos críticos ni altos detectados por las pruebas ejecutables en este entorno.

Se detectó un defecto funcional de severidad **media** en el dashboard docente: el indicador presentado como participación académica contaba intentos y no estudiantes únicos. Un alumno con dos o más intentos podía inflar la cifra general y la cifra por examen. El defecto fue corregido y se añadieron verificaciones de regresión.

## 2. Hallazgos y correcciones

| ID | Severidad | Hallazgo | Estado | Corrección |
|---|---|---|---|---|
| QA17-01 | Media | El dashboard contabilizaba intentos como participantes. | Corregido | La consulta ahora incluye `student_id`, deduplica estudiantes globalmente y por examen, y la interfaz utiliza el rótulo `Participantes`. |
| QA17-02 | Baja | README indicaba una etapa y número de migraciones desactualizados respecto al Prompt 16. | Corregido | README actualizado a Prompts 00–17 y 22 migraciones. |
| QA17-03 | Baja | ROADMAP no marcaba los Prompts 16 y 17 como completados. | Corregido | Roadmap actualizado. |

**Críticos abiertos: 0.**  
**Altos abiertos: 0.**  
**Medios abiertos: 0 detectados por esta batería.**

## 3. QA del flujo docente

La batería `npm run test:qa17` verifica estructuralmente que el proyecto conserve y conecte las funciones necesarias para:

- crear exámenes;
- editar exámenes;
- duplicarlos mediante la función segura de base de datos;
- activar y desactivar evaluaciones;
- gestionar bancos de preguntas;
- cargar imágenes de preguntas en `question-media`;
- exportar resultados a Excel y CSV.

Resultado del bloque: **PASS**.

## 4. QA del flujo estudiante

Se verificó la presencia e integración del flujo para:

- validar un código correcto;
- rechazar códigos inválidos desde servidor;
- preparar el intento antes de iniciar el cronómetro;
- iniciar el intento de forma independiente;
- utilizar `deadlineAt` y referencia temporal del servidor;
- autoguardar respuestas;
- aplicar guardado atómico para impedir sobrescrituras tardías;
- subir y finalizar evidencias;
- enviar definitivamente el examen;
- recuperar el flujo ante pérdida o expiración de la sesión temporal.

Resultado del bloque: **PASS**.

## 5. Aleatorización

Además de la simulación acumulativa previa de 50 alumnos, el Prompt 17 ejecutó una simulación independiente con **20 alumnos** y 20 preguntas por intento.

Resultados:

- alumnos simulados: 20;
- combinaciones distintas: 20;
- preguntas duplicadas dentro de un intento: 0;
- fallos de persistencia del conjunto asignado: 0;
- estructura real verificada: `intento_preguntas`, `options_snapshot` y `grading_snapshot`.

Resultado: **PASS**.

## 6. Cronómetro y reingreso

La prueba independiente confirma que el tiempo restante se deriva del `deadlineAt` original y no de una nueva cuenta regresiva local.

Escenarios modelados:

- recarga después de 12 minutos de un examen de 45 minutos: quedan 33 minutos;
- cierre y reingreso después de 25 minutos: quedan 20 minutos;
- el vencimiento duro permanece respaldado por la base de datos;
- el frontend sincroniza la referencia temporal con servidor.

Las pruebas acumulativas de recuperación también volvieron a pasar, incluyendo vencimiento con cola offline y ventana técnica limitada para consolidar respuestas ya registradas localmente antes del límite.

Resultado: **PASS**.

## 7. Calificación

Se comprobó que la migración real del motor contempla:

- alternativa única;
- selección múltiple;
- verdadero/falso;
- respuesta corta;
- numérica;
- cálculo;
- cálculo con evidencia;
- desarrollo/revisión manual;
- tolerancia numérica;
- intervalo numérico.

Las baterías existentes de calificación automática y manual volvieron a pasar sin regresiones.

Resultado: **PASS**.

## 8. Seguridad y estructura

Comprobaciones del Prompt 17:

- 22 migraciones presentes en `bootstrap_all.sql`;
- 131 imports locales comprobados;
- imports locales faltantes: 0;
- secretos `service_role` o equivalentes en frontend: 0;
- 64 archivos JS/JSX/TS/TSX transpilados para control sintáctico;
- errores sintácticos encontrados: 0.

La batería acumulativa de seguridad volvió a obtener **17/17 PASS**.

## 9. Resultado de la batería QA17

`npm run test:qa17`

- controles: 64;
- aprobados: 64;
- fallidos: 0;
- fallos críticos/altos: 0;
- estado: **PASS**.

El detalle máquina-legible se encuentra en:

`docs/QA_PROMPT17_RESULT.json`

## 10. Regresión acumulativa

Se ejecutó `npm run test:all` después de la corrección. Pasaron nuevamente:

- aleatorización;
- motor runtime;
- evidencias;
- calificación automática;
- calificación manual;
- resultados y analítica;
- exportación;
- seguridad;
- recuperación ante fallas;
- auditoría estricta;
- examen DEMO;
- QA independiente del Prompt 17.

Resultado acumulativo: **PASS**.

## 11. Validaciones que aún requieren infraestructura real

Dos comprobaciones no pueden considerarse cerradas en este entorno:

### Build real con Vite

Se intentó `npm install --no-audit --no-fund`, pero la operación agotó el tiempo de red y no dejó `node_modules`. Por ello, `npm run build` no puede certificarse todavía. La sintaxis se validó independientemente con TypeScript, pero esto no sustituye un build completo de Vite.

### Prueba extremo a extremo con Supabase

Las migraciones, RLS, funciones SQL, Storage y `exam-access` todavía deben ejecutarse contra una instancia Supabase real para comprobar:

- creación/edición/duplicación con datos reales;
- autenticación docente;
- RLS real;
- carga y lectura de archivos;
- Edge Function desplegada;
- concurrencia real;
- envío y corrección de un examen real;
- exportación usando datos persistidos.

Por esta razón, el resultado QA de esta etapa confirma la consistencia del código y de las simulaciones, pero **no equivale todavía a certificación de producción**.

## 12. Comandos de repetición

```bash
npm run test:qa17
npm run test:all
npm run audit:security
npm run audit:strict
```

Cuando las dependencias estén instaladas:

```bash
npm run build
```
