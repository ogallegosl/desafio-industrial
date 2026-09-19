# Validación — Desafío Industrial v1.2.0

## Auditoría específica

```bash
npm run audit:v120
```

Resultado esperado y obtenido durante el empaquetado:

```text
Live monitoring v1.2.0: 26/26 PASS
```

## Suite acumulativa

```bash
npm run test:all
```

Resultado: **PASS** después de incorporar la migración 0026 al `bootstrap_all.sql`.

## Auditoría de paquete

```bash
npm run audit:package
```

Resultado: versión `1.2.0`, 26 migraciones y 0 errores estructurales.

## Limitación de validación

La prueba extremo a extremo de Supabase Realtime requiere un proyecto Supabase real con las 26 migraciones aplicadas y la Edge Function desplegada. El código incluye un sondeo de respaldo de 15 segundos si Realtime no estuviera disponible.
