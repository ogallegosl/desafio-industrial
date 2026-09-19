export default function RouteFallback() {
  return (
    <div className="route-loading route-loading-screen" role="status" aria-live="polite">
      <span className="route-loading-spinner" aria-hidden="true" />
      <span>Cargando módulo…</span>
    </div>
  )
}
