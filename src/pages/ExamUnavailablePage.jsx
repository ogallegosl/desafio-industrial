import { Link, useLocation } from 'react-router-dom'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'

export default function ExamUnavailablePage() {
  const location = useLocation()
  const { formatDateTime } = useGlobalSettings()
  const state = location.state || {}
  const details = state.details || {}

  return (
    <section className="state-card state-warning">
      <div className="state-icon">!</div>
      <p className="eyebrow">Acceso restringido</p>
      <h1>{state.message || 'El examen no está disponible.'}</h1>
      {state.code && <p className="state-code">Código del sistema: {state.code}</p>}
      {(details.startsAt || details.endsAt) && (
        <div className="state-details">
          <div><span>Inicio</span><strong>{formatDateTime(details.startsAt)}</strong></div>
          <div><span>Cierre</span><strong>{formatDateTime(details.endsAt)}</strong></div>
        </div>
      )}
      <Link className="button primary" to="/acceso">Volver al acceso</Link>
    </section>
  )
}
