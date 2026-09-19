# Sistema visual — Prompt 01

## Objetivo

Interfaz sobria y académica para docentes universitarios y estudiantes. Prioriza legibilidad, jerarquía, espacios consistentes y navegación clara.

## Estructura

### Área pública
- inicio;
- acceso a examen;
- estado de examen no disponible;
- login docente.

### Área docente
- navegación lateral en escritorio;
- navegación inferior compacta en tablet/móvil;
- dashboard;
- cursos;
- bancos;
- exámenes;
- editor;
- resultados;
- evidencias;
- configuración.

### Área estudiante
- instrucciones;
- examen;
- revisión;
- confirmación.

## Responsive

Se han definido cortes principales en 1120 px, 900 px y 640 px.

En escritorio, el examen usa panel lateral persistente. En móvil, el cronómetro y el progreso pasan a una barra superior sticky para mantenerlos visibles.

## Estado técnico

La interfaz está conectada a los módulos persistentes implementados hasta el Prompt 15. Las pantallas que todavía corresponden a fases futuras, como la configuración institucional global, se muestran explícitamente como no disponibles y no simulan guardado.
