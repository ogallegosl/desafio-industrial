import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <section className="state-card">
      <div className="state-icon">404</div>
      <p className="eyebrow">Ruta no encontrada</p>
      <h1>Esta página no existe.</h1>
      <p>Regresa al inicio para continuar.</p>
      <Link className="button primary" to="/">Volver al inicio</Link>
    </section>
  )
}
