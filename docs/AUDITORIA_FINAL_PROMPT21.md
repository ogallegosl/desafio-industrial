# Auditoría final integral — Prompt 21

Fecha de cierre: 17 de septiembre de 2026.

## Resultado ejecutivo

La auditoría final revisó funcionalidad, experiencia de usuario, base de datos, seguridad, cronómetro, autoguardado, aleatorización, calificación, evidencias, exportaciones, responsive, rendimiento, mensajes de error, consistencia visual y accesibilidad básica.

Resultado local después de las correcciones:

- Auditoría específica Prompt 21: **43/43 PASS**.
- Fallos críticos o altos sin corregir: **0**.
- Suite acumulativa de Prompts 07–21: **PASS**.
- Seguridad: **17/17 PASS**.
- Recuperación ante fallas: **23/23 PASS**.
- Auditoría estricta previa: **26/26 PASS**.
- QA Prompt 17: **66/66 PASS**.
- Responsive en navegador: **28/28 PASS**.
- Errores sintácticos detectados en la revisión independiente: **0**.
- Migraciones versionadas: **24**.

No se declara todavía la plataforma como certificada para producción. Faltan dos validaciones que requieren infraestructura externa: instalar dependencias y ejecutar un build real de Vite, y ejecutar las 24 migraciones más la Edge Function contra un proyecto Supabase real con una prueba extremo a extremo.

## Hallazgos corregidos en esta auditoría

### 1. Escritura parcial al crear o editar un examen — severidad alta

**Problema.** La interfaz realizaba varias escrituras independientes para guardar el examen, su configuración y el código de acceso. Una interrupción de red entre operaciones podía dejar el examen parcialmente actualizado.

**Corrección.** La migración `0024_final_integrity_accessibility.sql` incorporó las funciones transaccionales `create_exam_bundle(...)` y `update_exam_bundle(...)`. Ambas operan mediante `SECURITY INVOKER`, respetan RLS y ejecutan el conjunto de cambios dentro de una sola transacción PostgreSQL. El servicio `examManagement.js` utiliza ahora estas RPC.

**Estado:** corregido y probado.

### 2. Configuración sin identidad estable del estudiante — severidad alta

**Problema.** El editor podía permitir que tanto código universitario como correo quedaran desactivados, aunque el motor de acceso necesita al menos un identificador estable.

**Corrección.** Se añadió la restricción `config_student_identifier_required` y se normalizaron configuraciones históricas inválidas habilitando código universitario. La interfaz bloquea el guardado si ambos identificadores están desactivados.

**Estado:** corregido y probado.

### 3. Cambio de curso con historial existente — severidad alta

**Problema.** Era posible modificar el curso de un examen que ya tenía preguntas vinculadas, reglas de selección o intentos. Eso podía dejar relaciones incoherentes entre curso, bancos y preguntas.

**Corrección.** Se añadió `prevent_exam_course_change_with_history()` y su trigger. El cambio de curso queda bloqueado cuando existe `preguntas_examen`, `reglas_seleccion_examen` o `intentos`. La interfaz también deshabilita el selector cuando existe un plan de preguntas.

**Estado:** corregido y probado.

### 4. Accesibilidad insuficiente en modales — severidad media

**Problema.** Los modales no atrapaban el foco, no restauraban el elemento de origen y la navegación con Tab podía salir del diálogo.

**Corrección.** `Modal.jsx` administra foco inicial, ciclo Tab/Shift+Tab, Escape, restauración de foco y atributos ARIA del diálogo.

**Estado:** corregido y probado.

### 5. Semántica incompleta durante el examen — severidad media

**Problema.** El progreso y el mapa de preguntas dependían principalmente de información visual.

**Corrección.** El progreso usa `role="progressbar"` y valores ARIA; la pregunta actual utiliza `aria-current="step"`.

**Estado:** corregido.

### 6. Controles de resultados/editor con información basada en estado visual — severidad media

**Problema.** Tabs y botones de respuesta correcta no comunicaban completamente su estado a tecnologías de asistencia.

**Corrección.** Se añadieron `role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"` y `aria-pressed` según corresponde.

**Estado:** corregido.

### 7. Navegación por teclado y contraste — severidad media

**Problema.** Faltaban enlaces de salto, un foco global suficientemente visible y algunos textos pequeños tenían contraste menor al objetivo WCAG AA para texto normal.

**Corrección.** Se incorporaron enlaces “Saltar al contenido principal”, reglas globales `:focus-visible` y se sustituyeron colores secundarios débiles por la variable accesible `--muted`.

**Estado:** corregido.

## Resultado por dimensión

| Dimensión | Resultado | Observación |
|---|---|---|
| Funcionalidad | PASS | Flujos docente/estudiante y operaciones transaccionales verificadas |
| UX | PASS | Validaciones, navegación y bloqueo de curso coherentes |
| Base de datos | PASS local | 24 migraciones presentes; ejecución real en Supabase pendiente |
| Seguridad | PASS | 17/17 controles, RLS y no exposición de claves de corrección |
| Cronómetro | PASS | `deadline_at` del servidor y cierre por tiempo conservados |
| Autoguardado | PASS | Guardado atómico, revisiones monotónicas y cola offline |
| Aleatorización | PASS | Preguntas congeladas y clave separada del snapshot visible |
| Calificación | PASS | Automática y manual/rúbricas sin duplicación de puntaje |
| Evidencias | PASS | Validación de firma, reemplazo seguro y Storage privado |
| Exportaciones | PASS | Excel/CSV y protección contra formula injection |
| Responsive | PASS | 360, 390, 430, 768 y 1366 px; 28/28 controles |
| Rendimiento | PASS local | Lazy routes, chunks y carga diferida; build real pendiente |
| Mensajes de error | PASS | Estados de acceso y validaciones diferenciados |
| Consistencia visual | PASS | Variables visuales centrales y contraste reforzado |
| Accesibilidad básica | PASS | Foco, skip links, progressbar, tabs y estados ARIA |

## Evidencia de pruebas posterior a la última corrección

Se ejecutó `npm run test:all` después de bloquear el cambio de curso. Los módulos de aleatorización, runtime, evidencias, calificación automática, calificación manual, analítica, exportación, seguridad, recuperación, auditoría estricta, DEMO, QA17, Prompt18, despliegue, configuración global y Prompt21 terminaron en PASS.

Se ejecutó además la comprobación independiente de sintaxis:

- archivos JSX/TS/TSX revisados mediante TypeScript: 48; errores: 0;
- archivos JS/MJS revisados mediante `node --check`: sin errores.

La prueba real con Chromium/Playwright sobre el harness responsive volvió a obtener **28/28 PASS**, sin desbordamiento horizontal en 360, 390, 430, 768 y 1366 px y con cronómetro visible.

## Validaciones externas pendientes

### Build real de Vite

El entorno no contiene `node_modules`. Al ejecutar `npm run build` se obtiene:

```text
sh: 1: vite: not found
```

Esto indica ausencia de la dependencia instalada, no un error de compilación demostrado. `npm install`/`npm ci` no pudo completarse anteriormente por timeout de acceso al registro npm. Antes de producción debe ejecutarse en un entorno con red:

```bash
npm ci
npm run build
```

### Supabase/PostgreSQL real

El entorno actual no dispone de una instancia Supabase/PostgreSQL conectada ni del CLI necesario para aplicar y revertir migraciones. Antes de un examen real deben probarse las 24 migraciones, Storage, Auth y la Edge Function sobre staging.

Secuencia mínima recomendada:

```bash
npm ci
npm run test:all
npm run build
supabase db push --dry-run
supabase db push
supabase functions deploy exam-access
```

Después debe realizarse una prueba extremo a extremo con, como mínimo, dos cuentas docentes y varios estudiantes simulando acceso correcto/incorrecto, pérdida de internet, vencimiento, carga de evidencia, corrección manual, publicación de resultados y exportación.

## Estado para la siguiente etapa

La versión 0.21.0 queda aprobada por la auditoría local del Prompt 21 y puede pasar al Prompt 22 para empaquetado final. La aprobación local no sustituye las dos validaciones externas anteriores.
