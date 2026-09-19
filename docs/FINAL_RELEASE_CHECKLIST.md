# Checklist de liberación final

## Código y estructura

- [x] `src/`, `public/`, `supabase/`, `docs/` presentes.
- [x] `package.json`, `vite.config.js`, `netlify.toml`, `.env.example` presentes.
- [x] 27 migraciones versionadas.
- [x] `bootstrap_all.sql` contiene las migraciones en orden.
- [x] No existen archivos vacíos en el paquete final.
- [x] No se incluyen secretos reales.

## Documentación

- [x] README.
- [x] CHANGELOG.
- [x] Arquitectura.
- [x] Base de datos.
- [x] Despliegue Netlify/Supabase.
- [x] Guía docente.
- [x] Guía estudiante.
- [x] Informe QA.
- [x] Guía de importación de examen completo v1.3.0.
- [x] Plantilla XLSX y paquete ZIP de ejemplo.

## Validación local

- [x] Suite lógica/QA incluida y ejecutada antes del empaquetado.
- [x] Auditoría final Prompt 21 en PASS.
- [x] Auditoría docente 63/63 PASS.
- [x] Auditoría del importador v1.3.0 25/25 PASS.
- [x] Deploy readiness 20/20 PASS.
- [x] Responsive validado en 360, 390, 430, 768 y 1366 px.
- [ ] Build real de Vite con `node_modules` instalados en este entorno. `npm install` agotó el tiempo de red disponible; no se generó `node_modules`, por lo que `vite` no está instalado localmente.
- [ ] Ejecución real de migraciones/Edge Function contra el proyecto Supabase de producción.

Los dos últimos controles deben completarse antes de utilizar la plataforma con estudiantes reales.
