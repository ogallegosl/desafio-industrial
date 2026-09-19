# Optimización responsive y rendimiento — Prompt 18

## Objetivo

Optimizar la interfaz y la carga de EvaluaLab sin alterar las reglas de examen, seguridad, calificación ni recuperación implementadas en etapas anteriores.

## Cambios de rendimiento

### Carga diferida por ruta

`src/App.jsx` dejó de importar todas las páginas de forma eager. Las vistas públicas, docentes y estudiantiles utilizan `React.lazy` y un `Suspense` común. Esto evita que un estudiante descargue inicialmente páginas de analítica, rúbricas, evidencias docentes y configuración que no necesita para rendir.

### División de bundle

`vite.config.js` separa:

- `react-vendor`: React, ReactDOM y React Router;
- `supabase-vendor`: cliente Supabase.

SheetJS/XLSX continúa cargándose mediante `await import('xlsx')` únicamente al importar o exportar archivos.

### Consultas

Se reemplazaron retornos `select('*')` del flujo principal de cursos/exámenes por listas explícitas de columnas o `id` cuando solo se necesita el identificador. Las consultas analíticas continúan en RPC del servidor y las vistas de evidencias generan URL firmada solo para el elemento seleccionado.

### Imágenes

- las vistas docentes/previsualizaciones utilizan `loading="lazy"` y `decoding="async"`;
- la imagen de la pregunta que el alumno está resolviendo se mantiene prioritaria (`fetchPriority="high"`) porque forma parte del contenido evaluado;
- se limita la altura visible en pantallas pequeñas sin recortar la imagen (`object-fit: contain`).

## Responsive

### Panel docente

En <=900 px la navegación ya no es una barra horizontal inferior. Se utiliza un drawer lateral con botón visible, overlay, bloqueo temporal del scroll del fondo y cierre mediante Escape.

### Examen del estudiante

En móvil:

- cronómetro y progreso permanecen sticky;
- botones Anterior/Siguiente permanecen dentro del viewport;
- imágenes técnicas se limitan por altura sin recorte;
- textos largos pueden cortar línea sin ensanchar el documento;
- el nombre del estudiante y marca se compactan progresivamente en 430/390/360 px.

### Accesibilidad y viewport

Se incorporaron `100dvh`, safe-area para el drawer y `prefers-reduced-motion`.

## Resoluciones verificadas

Se probaron mediante Playwright + Chromium:

- 360 × 900;
- 390 × 900;
- 430 × 900;
- 768 × 900;
- 1366 × 900.

La prueba verifica panel docente y examen estudiantil, overflow horizontal global, cronómetro visible, navegación dentro del viewport y drawer docente.

## Hallazgo corregido durante QA

La primera ejecución detectó un overflow horizontal de 2 px en 390 y 430 px causado por el margen negativo de `.exam-navigation`. Se eliminó ese margen en móvil y la repetición obtuvo 28/28 controles visuales correctos.

## Limitación de validación

No se pudo ejecutar `npm run build` porque el entorno de trabajo no logró completar `npm install`. Por esa razón no se declara una medición real del tamaño de chunks en KB. La estructura de code splitting y la sintaxis sí fueron verificadas; el build real debe ejecutarse en la fase de despliegue.
