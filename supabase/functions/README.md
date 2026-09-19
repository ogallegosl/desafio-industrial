# Edge Functions

## `exam-access`

Punto de entrada público controlado para estudiantes sin cuenta de Supabase Auth.

### Acciones

- `validate`: valida código y disponibilidad del examen.
- `prepare`: identifica al estudiante y crea/reanuda intento.
- `status`: recupera el estado básico del intento.
- `start`: congela preguntas e inicia el cronómetro.
- `engine`: entrega preguntas visibles, respuestas y estado runtime.
- `save_answer`: autoguarda una respuesta con revisión anti-conflicto.
- `navigate`: persiste y valida la navegación.
- `ping`: sincroniza hora y estado con el servidor.
- `submit`: cierra el intento.

Despliegue esperado:

```bash
supabase functions deploy exam-access
```

`supabase/config.toml` establece `verify_jwt = false` porque el estudiante utiliza un token opaco específico de intento. La función resuelve ese token en servidor y utiliza credenciales privilegiadas únicamente dentro del runtime de Supabase.
