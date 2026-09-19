export default function SaveStatus({ state = 'saved' }) {
  const content = {
    saved: ['✓', 'Respuesta guardada'],
    saving: ['…', 'Guardando...'],
    pending: ['•', 'Pendiente de guardar'],
    offline: ['!', 'Sin conexión · pendiente de sincronizar'],
    error: ['!', 'No se pudo guardar · se reintentará'],
  }[state] || ['•', 'Estado de guardado']

  return (
    <span className={`save-status save-${state}`} aria-live="polite">
      <b aria-hidden="true">{content[0]}</b>{content[1]}
    </span>
  )
}
