# Validación — Desafío Industrial v1.1.1

## Correcciones verificadas

- portada sin superposición entre título e imagen;
- segunda propuesta visual aplicada como imagen principal;
- fondos de acceso e instrucciones refinados;
- contador de integridad persistente en DEMO y flujo real;
- sincronización del contador con servidor;
- Screen Wake Lock para reducir apagado automático en celular;
- menor riesgo de falsos positivos móviles por eventos `blur`;
- una sola incidencia por interrupción de visibilidad;
- no se duplica incidencia de fullscreen cuando la página ya está oculta.

## Auditoría móvil

Anchos evaluados: **320, 360, 390, 430, 768 y 1366 px**.

Pantallas evaluadas:

- inicio;
- acceso;
- instrucciones;
- examen;
- revisión final.

Resultado: **63/63 PASS**. No se detectó overflow horizontal. En anchos de celular los controles táctiles principales alcanzan al menos 44 px de alto.

## Auditoría específica v1.1.1

Resultado: **17/17 PASS**.

## Suite acumulativa

`npm run test:all`: **PASS** después de las correcciones.

## Sintaxis

73 archivos JS/JSX/TS/TSX analizados mediante el parser de TypeScript: **0 errores de sintaxis**.

## Limitación técnica conocida

Screen Wake Lock depende del navegador y del sistema operativo. Cuando no está disponible, se recomienda aumentar temporalmente el tiempo de bloqueo automático del celular. La Web Platform no permite distinguir con certeza entre un bloqueo manual de pantalla y un cambio de aplicación.
