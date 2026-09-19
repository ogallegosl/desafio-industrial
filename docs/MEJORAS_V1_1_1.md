# Desafío Industrial v1.1.1

## Correcciones principales

### Portada

El título **Evaluación universitaria flexible** se separó en tres líneas y se limitó el ancho de cada columna para evitar que el texto invada la imagen. La imagen se reemplazó por la segunda propuesta visual de Ingeniería Industrial desarrollada durante el diseño.

### Acceso e instrucciones

Se añadieron fondos institucionales discretos con azul industrial, granate y dorado, manteniendo superficies blancas y contraste alto. No se incorporaron fondos saturados ni elementos decorativos que compitan con los formularios.

### Integridad

El contador anterior pertenecía al estado local del componente de seguridad. Al cambiar desde el examen a la página de revisión, React montaba un nuevo componente y el contador visual iniciaba en cero, aunque los eventos sí habían quedado registrados. v1.1.1 recupera el conteo persistido en el intento y sincroniza cada nuevo evento con el valor autoritativo del servidor.

En DEMO local el conteo se obtiene de `localStorage`; en producción se calcula desde los eventos `SECURITY_%` almacenados en `logs`.

### Celulares y pantalla inactiva

La plataforma solicita `navigator.wakeLock.request('screen')` cuando el navegador lo permite. Esto reduce el riesgo de que el bloqueo automático apague la pantalla mientras el alumno realiza cálculos en papel.

En móvil se desactiva el uso de `window.blur` como incidencia porque el teclado virtual, los permisos de cámara y elementos del sistema pueden causar falsos positivos. El cambio real de visibilidad de la página continúa registrado.

No existe una API web que permita distinguir con certeza un bloqueo manual de pantalla de un cambio a otra aplicación. Si el navegador no admite Wake Lock, se recomienda ampliar temporalmente el tiempo de bloqueo automático del dispositivo antes de iniciar la evaluación.

## Auditoría móvil

Se evaluaron 320, 360, 390, 430, 768 y 1366 px en:

- portada;
- acceso;
- instrucciones;
- examen;
- revisión final.

Resultado: **63/63 PASS**, sin overflow horizontal y con botones táctiles mínimos de 44 px en los anchos móviles evaluados.
