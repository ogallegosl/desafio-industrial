import { Link, Outlet, useLocation } from 'react-router-dom'
import Brand from '../components/Brand'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'

export default function PublicLayout() {
  const { settings } = useGlobalSettings()
  const location = useLocation()
  const accessPage = location.pathname === '/acceso'
  return (
    <>
      <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
      <div className={`app-shell public-shell ${accessPage ? 'public-shell-access' : ''}`}>
      <header className="public-topbar">
        <div className="public-topbar-inner">
          <Brand />
          <nav className="public-nav" aria-label="Navegación principal">
            <Link to="/acceso">Ingresar a examen</Link>
            <Link className="button button-small secondary" to="/docente/login">Acceso docente</Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="page-container">
        <Outlet />
      </main>
      <footer className="public-footer">
        <div>{settings.platformName} · {settings.institutionName}</div>
        <span>Plataforma académica de evaluación</span>
      </footer>
      </div>
    </>
  )
}
