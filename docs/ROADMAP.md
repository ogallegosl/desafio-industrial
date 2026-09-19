# Roadmap de desarrollo

## Fase 0 — Base arquitectónica
Estado: completada en esta versión.

Incluye:
- estructura del proyecto;
- React/Vite;
- rutas iniciales;
- layouts;
- cliente Supabase preparado;
- documentación de arquitectura;
- configuración Netlify;
- variables de entorno de ejemplo.

## Fase 1 — Sistema visual
Corresponde al Prompt 01.

Objetivo:
- sistema de diseño;
- navegación completa;
- vistas docente y estudiante;
- responsive.

## Fase 2 — Base de datos
Corresponde al Prompt 02.

Objetivo:
- modelo PostgreSQL;
- migraciones;
- RLS;
- políticas;
- Storage.

## Fase 3 — Acceso y roles
Corresponde al Prompt 03.

Objetivo:
- autenticación docente;
- identificación estudiante;
- validaciones de acceso;
- control de intentos.

## Fase 4 — Gestión docente
Prompts 04 a 06.

Estado: completada hasta Prompt 06.

Objetivo:
- exámenes;
- bancos;
- preguntas;
- multimedia;
- importación Excel/CSV.

## Fase 5 — Ejecución del examen
Prompts 07 a 09.

Estado: completada hasta Prompt 09.

Objetivo:
- aleatorización;
- congelamiento de examen por alumno;
- cronómetro;
- autoguardado;
- evidencias.

## Fase 6 — Calificación
Prompts 10 y 11.

Estado: completada hasta Prompt 11.

Incluye corrección automática, tolerancias, intervalos, revisión manual y rúbricas.

Objetivo:
- corrección automática;
- tolerancias;
- revisión manual;
- rúbricas.

## Fase 7 — Resultados
Prompts 12 y 13.

Estado:
- Prompt 12: completado — analítica por examen, pregunta y estudiante.
- Prompt 13: completado — exportación Excel/CSV.

Objetivo:
- analítica;
- resultados por examen/pregunta/alumno;
- Excel/CSV.

## Fase 8 — Robustez
Prompts 14 a 18.

**Prompt 14 — Seguridad y control de integridad: completado.**

**Prompt 15 — Recuperación ante fallas: completado.**

**Prompt 16 — Examen DEMO: completado.**

**Prompt 17 — QA integral y regresiones: completado.**

**Prompt 18 — Optimización responsive y rendimiento: completado.**

Objetivo:
- seguridad;
- recuperación ante fallas;
- QA;
- rendimiento;
- responsive.

## Fase 9 — Producción
Prompts 19 a 23.

Estado: Prompts 19, 20 y 21 completados; Prompts 22–23 pendientes.

Prompt 19 incorporó preparación Netlify/Supabase, variables, validación de despliegue y guía de producción.

Prompt 20 incorporó configuración global persistente, identidad institucional, zona horaria y reglas de evidencia.

Prompt 21 completó la auditoría final integral, corrigió integridad transaccional, consistencia de curso e identidad del estudiante, y reforzó accesibilidad básica.

Pendiente:
- empaquetado final;
- reglas de continuidad.


## Estado final — Prompt 22

La construcción planificada está completada hasta el empaquetado final. Las futuras modificaciones deben tratarse como mantenimiento evolutivo, conservando las migraciones, contratos de datos y pruebas acumuladas.
